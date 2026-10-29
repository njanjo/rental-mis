import "server-only";

import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import { assertCapability, chunkIn, scopePropertyIds } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import {
  BANK_IMPORT_PREVIEW_ROWS,
  parseBankStatement,
  type ParsedBankStatement,
  type ParsedStatementRow,
} from "@/lib/bank-import";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { paymentIdForReference } from "@/lib/payments";
import type { BankSyncRun, MinorUnits, Tenant } from "@/lib/types";
import type {
  BankImportIssue,
  BankImportPreview,
  BankImportPreviewRow,
  BankImportResult,
  BankImportRunItem,
  BankImportTotals,
  BankRowMatch,
} from "@/lib/types/views";
import type { BankImportInput } from "@/lib/validation/bank-import";
import {
  recordConfirmedPayment,
  recordUnmatchedPayment,
} from "@/services/payments";

const RUN_COLLECTION = "bankSyncRuns";
const PHONE_INDEX = "tenantPhones";
const TENANT_COLLECTION = "tenants";

/** Firestore caps a batch `getAll` at 500 documents; stay well under it. */
const READ_BATCH = 250;

function parse(input: BankImportInput): ParsedBankStatement {
  try {
    return parseBankStatement(input.csv, {
      mapping: input.mapping,
      dateFormat: input.dateFormat,
    });
  } catch (error) {
    throw new ServiceError(
      "validation",
      error instanceof Error
        ? error.message
        : "That statement could not be read.",
    );
  }
}

function tenantProperties(tenant: Tenant): string[] {
  const ids = new Set<string>(tenant.propertyIds ?? []);
  if (tenant.currentPropertyId) ids.add(tenant.currentPropertyId);
  return [...ids];
}

function tenantPropertyId(tenant: Tenant): string | undefined {
  return tenant.currentPropertyId ?? tenant.propertyIds?.[0];
}

async function loadPhoneIndex(phones: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(phones.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const db = adminDb();
  for (let index = 0; index < unique.length; index += READ_BATCH) {
    const refs = unique
      .slice(index, index + READ_BATCH)
      .map((phone) => db.collection(PHONE_INDEX).doc(phone));
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;
      const data = snapshot.data() as { tenantId?: string; active?: boolean };
      if (data.active === true && data.tenantId) {
        result.set(snapshot.id, data.tenantId);
      }
    });
  }

  return result;
}

async function loadTenants(ids: string[]): Promise<Map<string, Tenant>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result = new Map<string, Tenant>();
  if (unique.length === 0) return result;

  const db = adminDb();
  for (const chunk of chunkIn(unique)) {
    const snapshot = await db
      .collection(TENANT_COLLECTION)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      result.set(doc.id, { ...(doc.data() as Tenant), id: doc.id });
    });
  }

  return result;
}

async function loadExistingPaymentIds(ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result = new Set<string>();
  if (unique.length === 0) return result;

  const db = adminDb();
  for (let index = 0; index < unique.length; index += READ_BATCH) {
    const refs = unique
      .slice(index, index + READ_BATCH)
      .map((id) => db.collection("payments").doc(id));
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) result.add(snapshot.id);
    });
  }

  return result;
}

interface RowMatch {
  match: BankRowMatch;
  tenantId?: string;
  tenantName?: string;
  propertyId?: string;
  reason?: string;
}

interface ClassifiedRow {
  row: ParsedStatementRow;
  paymentId: string;
  outcome: RowMatch;
}

function unmatchedReason(row: ParsedStatementRow, tenants: Map<string, Tenant>, phoneIndex: Map<string, string>): RowMatch {
  if (!row.payerPhone) {
    return {
      match: "unmatched",
      reason: "No payer phone number on this row, so no tenant can be confirmed.",
    };
  }

  const tenantId = phoneIndex.get(row.payerPhone);
  if (!tenantId) {
    return {
      match: "unmatched",
      reason: `No active tenant is registered with ${row.payerPhone}.`,
    };
  }

  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return {
      match: "unmatched",
      reason: `The tenant registered with ${row.payerPhone} no longer exists.`,
    };
  }
  if (tenant.status !== "active") {
    return {
      match: "unmatched",
      reason: `${tenant.fullName} is ${tenant.status}, not active, so the payment needs review.`,
    };
  }
  if (!tenantPropertyId(tenant)) {
    return {
      match: "unmatched",
      reason: `${tenant.fullName} is not linked to a property.`,
    };
  }

  return {
    match: "unmatched",
    tenantId,
    reason: "No reliable tenant match on this statement row.",
  };
}

/**
 * Resolve every credit row against the unique active phone index. A phone that
 * maps to a live, active tenant is a candidate; nothing is guessed from names
 * or free-text narrations.
 */
function classifyRows(
  actor: SessionUser,
  parsed: ParsedBankStatement,
  tenantByPhone: Map<string, string>,
  tenants: Map<string, Tenant>,
  existingPaymentIds: Set<string>,
): ClassifiedRow[] {
  const scope = scopePropertyIds(actor);

  return parsed.rows.map((row) => {
    const paymentId = paymentIdForReference("bank", row.reference);
    if (existingPaymentIds.has(paymentId)) {
      return {
        row,
        paymentId,
        outcome: {
          match: "duplicate",
          reason: "This reference is already in the ledger.",
        },
      };
    }

    if (!row.payerPhone) {
      return { row, paymentId, outcome: unmatchedReason(row, tenants, tenantByPhone) };
    }

    const tenantId = tenantByPhone.get(row.payerPhone);
    const tenant = tenantId ? tenants.get(tenantId) : undefined;

    if (!tenant) {
      return { row, paymentId, outcome: unmatchedReason(row, tenants, tenantByPhone) };
    }

    const propertyId = tenantPropertyId(tenant);
    if (!propertyId) {
      return { row, paymentId, outcome: unmatchedReason(row, tenants, tenantByPhone) };
    }

    const base = {
      tenantId: tenant.id,
      tenantName: tenant.fullName,
      propertyId,
    };

    if (tenant.status !== "active") {
      return {
        row,
        paymentId,
        outcome: {
          ...base,
          match: "unmatched",
          reason: `${tenant.fullName} is ${tenant.status}, not active.`,
        },
      };
    }

    if (scope !== null) {
      const accessible = tenantProperties(tenant).some((id) => scope.includes(id));
      if (!accessible) {
        return {
          row,
          paymentId,
          outcome: {
            ...base,
            match: "out_of_scope",
            reason: `${tenant.fullName} is outside the properties you manage.`,
          },
        };
      }
    }

    return {
      row,
      paymentId,
      outcome: { ...base, match: "tenant" },
    };
  });
}

async function classify(
  actor: SessionUser,
  parsed: ParsedBankStatement,
): Promise<ClassifiedRow[]> {
  const [tenantByPhone, existingPaymentIds] = await Promise.all([
    loadPhoneIndex(
      parsed.rows.flatMap((row) => (row.payerPhone ? [row.payerPhone] : [])),
    ),
    loadExistingPaymentIds(
      parsed.rows.map((row) => paymentIdForReference("bank", row.reference)),
    ),
  ]);

  const tenants = await loadTenants([...tenantByPhone.values()]);
  return classifyRows(actor, parsed, tenantByPhone, tenants, existingPaymentIds);
}

function totalsFor(
  parsed: ParsedBankStatement,
  classified: ClassifiedRow[],
): BankImportTotals {
  const totals: BankImportTotals = {
    dataRows: parsed.rows.length,
    matched: 0,
    unmatched: 0,
    outOfScope: 0,
    duplicates: 0,
    skipped: parsed.skipped.length,
    errors: parsed.errors.length,
    amountMinor: parsed.rows.reduce<MinorUnits>(
      (sum, row) => sum + row.amountMinor,
      0,
    ),
  };

  for (const { outcome } of classified) {
    if (outcome.match === "tenant") totals.matched += 1;
    else if (outcome.match === "unmatched") totals.unmatched += 1;
    else if (outcome.match === "out_of_scope") totals.outOfScope += 1;
    else totals.duplicates += 1;
  }

  return totals;
}

function issuesFor(parsed: ParsedBankStatement): BankImportIssue[] {
  return [...parsed.skipped, ...parsed.errors].sort((a, b) => a.line - b.line);
}

/**
 * Advisory preview. It writes nothing: the commit re-parses and re-matches the
 * same file so a stale preview can never move money by itself.
 */
export async function previewBankStatement(
  actor: SessionUser,
  input: BankImportInput,
): Promise<BankImportPreview> {
  assertCapability(actor, "reconcile_payments");

  const parsed = parse(input);
  const classified = await classify(actor, parsed);

  const rows: BankImportPreviewRow[] = classified
    .slice(0, BANK_IMPORT_PREVIEW_ROWS)
    .map(({ row, outcome }) => ({
      line: row.line,
      date: row.dateIso,
      reference: row.reference,
      amountMinor: row.amountMinor,
      ...(row.payerName ? { payerName: row.payerName } : {}),
      ...(row.payerPhone ? { payerPhone: row.payerPhone } : {}),
      ...(row.narration ? { narration: row.narration } : {}),
      match: outcome.match,
      ...(outcome.tenantId ? { tenantId: outcome.tenantId } : {}),
      ...(outcome.tenantName ? { tenantName: outcome.tenantName } : {}),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    }));

  return {
    ...(input.fileName ? { fileName: input.fileName } : {}),
    bankCode: input.bankCode,
    headers: parsed.headers,
    headerLine: parsed.headerLine,
    mapping: parsed.mapping,
    dateFormat: parsed.dateFormat,
    rows,
    issues: issuesFor(parsed),
    totals: totalsFor(parsed, classified),
    truncated: classified.length > rows.length,
  };
}

/**
 * Import a statement. Each receipt is its own transaction, so one bad row does
 * not roll back a whole file. Anything without a reliable tenant goes to the
 * unmatched queue; nothing is guessed.
 */
export async function commitBankStatement(
  actor: SessionUser,
  input: BankImportInput,
): Promise<BankImportResult> {
  assertCapability(actor, "enter_manual_receipts");
  assertCapability(actor, "reconcile_payments");

  const parsed = parse(input);
  const classified = await classify(actor, parsed);
  const db = adminDb();
  const runRef = db.collection(RUN_COLLECTION).doc();

  const counts = {
    fetched: parsed.rows.length,
    imported: 0,
    queued: 0,
    duplicates: 0,
    skipped: parsed.skipped.length,
    errors: parsed.errors.length,
  };
  let errorSample: string | undefined;

  await runRef.set({
    bankCode: input.bankCode,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    source: "statement",
    importedBy: actor.uid,
    startedAt: FieldValue.serverTimestamp(),
    status: "running",
    counts: {
      fetched: counts.fetched,
      imported: 0,
      duplicates: 0,
      errors: counts.errors,
      queued: 0,
      skipped: counts.skipped,
    },
  });

  try {
    for (const { row, outcome } of classified) {
      if (outcome.match === "duplicate") {
        counts.duplicates += 1;
        continue;
      }

      const common = {
        provider: "bank" as const,
        providerTransactionId: row.reference,
        amountMinor: row.amountMinor,
        receivedAt: row.date,
        source: "statement" as const,
        bankCode: input.bankCode,
        ignoreDuplicate: true,
        ...(row.narration ? { narration: row.narration } : {}),
        ...(row.payerName ? { payerName: row.payerName } : {}),
        ...(row.payerPhone ? { payerPhone: row.payerPhone } : {}),
      };

      try {
        if (outcome.match === "tenant" && outcome.tenantId) {
          const result = await recordConfirmedPayment(actor, {
            ...common,
            tenantId: outcome.tenantId,
            auditAction: "payment.imported",
          });
          if (result.duplicate) counts.duplicates += 1;
          else counts.imported += 1;
        } else {
          const result = await recordUnmatchedPayment(actor, {
            ...common,
            reason:
              outcome.reason ??
              "No reliable tenant match on the statement row.",
          });
          if (result.duplicate) counts.duplicates += 1;
          else counts.queued += 1;
        }
      } catch (error) {
        // A single receipt failing must not abort the rest of the file. The
        // count and the first error surface the problem for a retry.
        counts.errors += 1;
        errorSample ??=
          error instanceof Error ? error.message : "Unknown import error.";
      }
    }

    await db.runTransaction(async (tx) => {
      tx.update(runRef, {
        status: "succeeded",
        finishedAt: FieldValue.serverTimestamp(),
        ...(errorSample ? { errorSample } : {}),
        counts: {
          fetched: counts.fetched,
          imported: counts.imported,
          duplicates: counts.duplicates,
          errors: counts.errors,
          queued: counts.queued,
          skipped: counts.skipped,
        },
      });

      writeAuditLog(tx, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "bank_import.committed",
        entityType: "bankSyncRun",
        entityId: runRef.id,
        after: {
          bankCode: input.bankCode,
          fileName: input.fileName,
          ...counts,
          amountMinor: parsed.rows.reduce<MinorUnits>(
            (sum, row) => sum + row.amountMinor,
            0,
          ),
        },
      });
    });

    return {
      runId: runRef.id,
      imported: counts.imported,
      queued: counts.queued,
      duplicates: counts.duplicates,
      skipped: counts.skipped,
      errors: counts.errors,
    };
  } catch (error) {
    await runRef
      .update({
        status: "failed",
        finishedAt: FieldValue.serverTimestamp(),
        ...(errorSample ? { errorSample } : {}),
        counts: {
          fetched: counts.fetched,
          imported: counts.imported,
          duplicates: counts.duplicates,
          errors: counts.errors,
          queued: counts.queued,
          skipped: counts.skipped,
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

/** Recent statement runs, newest first. */
export async function listRecentBankImports(
  actor: SessionUser,
  limit = 10,
): Promise<BankImportRunItem[]> {
  assertCapability(actor, "reconcile_payments");

  const snapshot = await adminDb()
    .collection(RUN_COLLECTION)
    .orderBy("startedAt", "desc")
    .limit(Math.min(Math.max(limit, 1), 25))
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as BankSyncRun }))
    .filter(({ data }) => data.source !== "api")
    .map(({ id, data }) => ({
      id,
      bankCode: data.bankCode,
      ...(data.fileName ? { fileName: data.fileName } : {}),
      status: data.status,
      fetched: data.counts?.fetched ?? 0,
      imported: data.counts?.imported ?? 0,
      queued: data.counts?.queued ?? 0,
      duplicates: data.counts?.duplicates ?? 0,
      skipped: data.counts?.skipped ?? 0,
      errors: data.counts?.errors ?? 0,
      startedAt: toIsoString(data.startedAt) ?? "",
      ...(data.finishedAt ? { finishedAt: toIsoString(data.finishedAt) } : {}),
    }));
}
