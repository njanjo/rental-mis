import "server-only";

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import {
  assertCapability,
  assertPropertyAccess,
  chunkIn,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import {
  coveredDays,
  dueDateForPeriod,
  effectiveInvoiceStatus,
  invoiceIdFor,
  periodBounds,
  periodLabel,
  proratedRent,
} from "@/lib/billing";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type {
  Invoice,
  InvoiceStatus,
  Lease,
  Payment,
  PaymentAllocation,
  Tenant,
  Unit,
} from "@/lib/types";
import type {
  InvoiceAllocationItem,
  InvoiceDetail,
  InvoiceGenerationResult,
  InvoiceListItem,
  PageResult,
} from "@/lib/types/views";
import type { InvoiceGenerateInput } from "@/lib/validation/invoice";
import { getPropertyNames } from "@/services/properties";
import { getStaffNames } from "@/services/staff";

const COLLECTION = "invoices";
const LEASE_COLLECTION = "leases";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;
const LEASE_SCAN_LIMIT = 500;

export interface ListInvoicesParams {
  q?: string;
  propertyId?: string;
  status?: InvoiceStatus | "all";
  periodKey?: string;
  cursor?: string;
  pageSize?: number;
}

function clampPageSize(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

function inScope(scope: string[] | null, propertyId: string): boolean {
  return scope === null || scope.includes(propertyId);
}

/**
 * Firestore filters property, stored status and period. `overdue` is derived,
 * so it narrows to live invoices in the query and finishes in memory.
 */
function buildQuery(
  scope: string[] | null,
  params: ListInvoicesParams,
): { query: Query; scopeFallback: string[] | null } {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("dueDate", "desc");
  let scopeFallback: string[] | null = null;

  if (params.propertyId) {
    query = query.where("propertyId", "==", params.propertyId);
  } else if (scope) {
    if (scope.length <= 30) {
      query = query.where("propertyId", "in", scope);
    } else {
      scopeFallback = scope;
    }
  }

  if (params.status === "overdue") {
    query = query.where("status", "in", ["open", "partial"]);
  } else if (params.status && params.status !== "all") {
    query = query.where("status", "==", params.status);
  }

  if (params.periodKey) {
    query = query.where("periodKey", "==", params.periodKey);
  }

  return { query, scopeFallback };
}

async function applyCursor(query: Query, cursor?: string): Promise<Query> {
  if (!cursor) return query;
  const snapshot = await adminDb().collection(COLLECTION).doc(cursor).get();
  if (!snapshot.exists) return query;
  return query.startAfter(snapshot);
}

interface TenantSummary {
  name: string;
  phone: string;
}

async function tenantsById(
  ids: string[],
): Promise<Record<string, TenantSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const result: Record<string, TenantSummary> = {};

  for (const chunk of chunkIn(unique)) {
    const snapshot = await db
      .collection("tenants")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as Tenant;
      result[doc.id] = {
        name: data.fullName ?? doc.id,
        phone: data.phoneE164 ?? "",
      };
    });
  }

  return result;
}

async function unitsById(
  ids: string[],
): Promise<Record<string, { unitNumber: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const result: Record<string, { unitNumber: string }> = {};

  for (const chunk of chunkIn(unique)) {
    const snapshot = await db
      .collection("units")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as Unit;
      result[doc.id] = { unitNumber: data.unitNumber ?? doc.id };
    });
  }

  return result;
}

async function decorate(
  docs: DocumentSnapshot[],
): Promise<InvoiceListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as Invoice }));

  const [propertyNames, tenants, units] = await Promise.all([
    getPropertyNames(rows.map((row) => row.data.propertyId)),
    tenantsById(rows.map((row) => row.data.tenantId)),
    unitsById(rows.map((row) => row.data.unitId ?? "")),
  ]);

  return rows.map(({ id, data }) => {
    const tenant = tenants[data.tenantId];
    const unit = units[data.unitId ?? ""];
    const status = effectiveInvoiceStatus(
      data.status,
      data.dueDate?.toDate?.() ?? new Date(0),
    );

    return {
      id,
      leaseId: data.leaseId,
      tenantId: data.tenantId,
      tenantName: tenant?.name ?? data.tenantId,
      tenantPhone: tenant?.phone,
      unitId: data.unitId ?? "",
      unitNumber: unit?.unitNumber ?? data.unitId ?? "",
      propertyId: data.propertyId,
      propertyName: propertyNames[data.propertyId] ?? data.propertyId,
      periodKey: data.periodKey,
      periodLabel: periodLabel(data.periodKey),
      dueDate: toIsoString(data.dueDate) ?? "",
      amountDueMinor: data.amountDueMinor ?? 0,
      amountPaidMinor: data.amountPaidMinor ?? 0,
      balanceMinor: data.balanceMinor ?? 0,
      currency: data.currency ?? "KES",
      status,
      storedStatus: data.status,
      isOverdue: status === "overdue",
      billableDays: data.billableDays,
      periodDays: data.periodDays,
      voidReason: data.voidReason,
      voidedAt: toIsoString(data.voidedAt),
      createdAt: toIsoString(data.createdAt) ?? "",
      updatedAt: toIsoString(data.updatedAt) ?? "",
    } satisfies InvoiceListItem;
  });
}

export async function listInvoices(
  actor: SessionUser,
  params: ListInvoicesParams = {},
): Promise<PageResult<InvoiceListItem>> {
  assertCapability(actor, "view_financials");

  const scope = scopePropertyIds(actor);
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const overdueOnly = params.status === "overdue";

  const { query: base, scopeFallback } = buildQuery(scope, params);
  // Post-filtered views (search, derived overdue, >30 scoped properties) run in
  // memory because Firestore cannot express them; they have no next cursor.
  const inMemory = Boolean(q || overdueOnly || scopeFallback);

  if (inMemory) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeFallback) {
      rows = rows.filter((row) => inScope(scopeFallback, row.propertyId));
    }
    if (overdueOnly) rows = rows.filter((row) => row.isOverdue);
    if (q) {
      const digits = q.replace(/\D/g, "").replace(/^0+/, "");
      rows = rows.filter(
        (row) =>
          row.tenantName.toLowerCase().includes(q) ||
          row.unitNumber.toLowerCase().includes(q) ||
          row.propertyName.toLowerCase().includes(q) ||
          row.periodLabel.toLowerCase().includes(q) ||
          row.periodKey.includes(q) ||
          (digits.length >= 3 &&
            (row.tenantPhone ?? "").replace(/\D/g, "").includes(digits)),
      );
    }
    return { items: rows, nextCursor: null };
  }

  const query = await applyCursor(base, params.cursor);
  const snapshot = await query.limit(pageSize + 1).get();
  let docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  const items = await decorate(docs);

  return {
    items,
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

async function allocationsForInvoice(
  invoiceId: string,
): Promise<InvoiceAllocationItem[]> {
  const db = adminDb();
  const snapshot = await db
    .collection("paymentAllocations")
    .where("invoiceId", "==", invoiceId)
    .orderBy("createdAt", "asc")
    .get();

  if (snapshot.empty) return [];

  const allocations = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as PaymentAllocation,
  }));

  const payments: Record<string, Payment> = {};
  for (const chunk of chunkIn(allocations.map((row) => row.data.paymentId))) {
    const paymentSnapshot = await db
      .collection("payments")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    paymentSnapshot.docs.forEach((doc) => {
      payments[doc.id] = doc.data() as Payment;
    });
  }

  const staffNames = await getStaffNames(
    allocations.map((row) => row.data.createdBy),
  );

  return allocations.map(({ id, data }) => {
    const payment = payments[data.paymentId];
    return {
      id,
      paymentId: data.paymentId,
      amountMinor: data.amountMinor,
      provider: payment?.provider ?? "unknown",
      providerTransactionId: payment?.providerTransactionId ?? data.paymentId,
      receivedAt: toIsoString(payment?.receivedAt) ?? "",
      createdByName: staffNames[data.createdBy] ?? data.createdBy,
      createdAt: toIsoString(data.createdAt) ?? "",
    } satisfies InvoiceAllocationItem;
  });
}

export async function getInvoice(
  actor: SessionUser,
  invoiceId: string,
): Promise<InvoiceDetail> {
  assertCapability(actor, "view_financials");

  const snapshot = await adminDb().collection(COLLECTION).doc(invoiceId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Invoice not found.");
  }

  const invoice = snapshot.data() as Invoice;
  assertPropertyAccess(actor, invoice.propertyId);

  const [item] = await decorate([snapshot]);
  const allocations = await allocationsForInvoice(invoiceId);

  return { ...item, allocations };
}

/**
 * Create missing invoices for one billing period.
 *
 * One invoice per active lease, with a deterministic id so reruns are safe.
 * Leases that start or end mid-month are prorated by calendar day. Voided
 * invoices are never recreated.
 */
export async function generateInvoices(
  actor: SessionUser,
  input: InvoiceGenerateInput,
): Promise<InvoiceGenerationResult> {
  assertCapability(actor, "manage_invoices");

  const bounds = periodBounds(input.period);
  if (!bounds) {
    throw new ServiceError("validation", "Choose a valid billing month.", {
      fieldErrors: { period: ["Choose a valid billing month."] },
    });
  }

  const scope = scopePropertyIds(actor);
  const db = adminDb();

  const leases: Array<{ id: string; data: Lease }> = [];
  let cursor: string | undefined;
  do {
    let query: Query = db
      .collection(LEASE_COLLECTION)
      .where("status", "==", "active")
      .orderBy(FieldPath.documentId())
      .limit(LEASE_SCAN_LIMIT);
    if (cursor) {
      query = query.startAfter(
        db.collection(LEASE_COLLECTION).doc(cursor),
      );
    }
    const snapshot = await query.get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as Lease;
      if (inScope(scope, data.propertyId)) {
        leases.push({ id: doc.id, data });
      }
    });
    cursor =
      snapshot.size === LEASE_SCAN_LIMIT
        ? snapshot.docs[snapshot.docs.length - 1]?.id
        : undefined;
  } while (cursor);

  let created = 0;
  let skipped = 0;

  for (const lease of leases) {
    const billableDays = coveredDays(
      lease.data.startDate.toDate(),
      lease.data.endDate.toDate(),
      bounds,
    );
    // Leases that do not overlap the period are not billed for it.
    if (billableDays <= 0) continue;

    const dueDate = dueDateForPeriod(input.period, lease.data.dueDay);
    if (!dueDate) continue;

    const id = invoiceIdFor(lease.id, input.period);
    const ref = db.collection(COLLECTION).doc(id);

    const wasCreated = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return false;

      const amountDueMinor = proratedRent(
        lease.data.rentAmountMinor,
        billableDays,
        bounds.daysInMonth,
      );

      tx.set(ref, {
        leaseId: lease.id,
        tenantId: lease.data.tenantId,
        unitId: lease.data.unitId,
        propertyId: lease.data.propertyId,
        periodKey: input.period,
        dueDate: Timestamp.fromDate(dueDate),
        amountDueMinor,
        amountPaidMinor: 0,
        balanceMinor: amountDueMinor,
        currency: lease.data.currency ?? "KES",
        status: "open",
        billableDays,
        periodDays: bounds.daysInMonth,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      writeAuditLog(tx, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "invoice.generated",
        entityType: "invoice",
        entityId: id,
        after: {
          leaseId: lease.id,
          tenantId: lease.data.tenantId,
          propertyId: lease.data.propertyId,
          periodKey: input.period,
          amountDueMinor,
          billableDays,
          periodDays: bounds.daysInMonth,
        },
      });

      return true;
    });

    if (wasCreated) created += 1;
    else skipped += 1;
  }

  return {
    periodKey: input.period,
    created,
    skipped,
    total: created + skipped,
  };
}

/**
 * Void an unpaid invoice. Paid or partly paid invoices must have their
 * allocations reversed first; this keeps the payment ledger append-only.
 */
export async function voidInvoice(
  actor: SessionUser,
  invoiceId: string,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_invoices");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(invoiceId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Invoice not found.");
    }

    const invoice = snapshot.data() as Invoice;
    assertPropertyAccess(actor, invoice.propertyId);

    if (invoice.status === "void") {
      throw new ServiceError("conflict", "This invoice is already void.");
    }
    if ((invoice.amountPaidMinor ?? 0) > 0 || invoice.status === "paid") {
      throw new ServiceError(
        "conflict",
        "This invoice has payments against it. Reverse the allocations before voiding it.",
      );
    }

    tx.update(ref, {
      status: "void",
      balanceMinor: 0,
      voidReason: reason,
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "invoice.voided",
      entityType: "invoice",
      entityId: invoiceId,
      before: {
        status: invoice.status,
        amountDueMinor: invoice.amountDueMinor,
        balanceMinor: invoice.balanceMinor,
      },
      after: { status: "void", balanceMinor: 0 },
      reason,
    });
  });
}
