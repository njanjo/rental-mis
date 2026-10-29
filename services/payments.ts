import "server-only";

import { randomUUID } from "node:crypto";

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import {
  assertCapability,
  assertPropertyAccess,
  chunkIn,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { periodLabel, statusForBalance } from "@/lib/billing";
import { toDateInput, toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { paymentIdForReference, referenceOptional } from "@/lib/payments";
import type {
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentProvider,
  PaymentSource,
  PaymentStatus,
  ReviewStatus,
  Tenant,
  UnmatchedPayment,
} from "@/lib/types";
import { enqueueSmsWithinTransaction } from "@/services/sms";
import type {
  PageResult,
  PaymentAllocationLine,
  PaymentDetail,
  PaymentListItem,
  UnmatchedPaymentListItem,
} from "@/lib/types/views";
import type {
  ManualReceiptInput,
  UnmatchedIgnoreInput,
  UnmatchedResolveInput,
} from "@/lib/validation/payment";
import { allocateWithinTransaction } from "@/services/allocations";
import { getPropertyNames } from "@/services/properties";
import { getStaffNames } from "@/services/staff";

const COLLECTION = "payments";
const ALLOCATION_COLLECTION = "paymentAllocations";
const UNMATCHED_COLLECTION = "unmatchedPayments";
const INVOICE_COLLECTION = "invoices";
const TENANT_COLLECTION = "tenants";

const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListPaymentsParams {
  q?: string;
  propertyId?: string;
  status?: PaymentStatus | "all";
  provider?: PaymentProvider | "all";
  cursor?: string;
  pageSize?: number;
}

export interface ListUnmatchedParams {
  /** `open` means pending or assigned; `all` includes resolved/ignored. */
  status?: ReviewStatus | "open" | "all";
  pageSize?: number;
}

function clampPageSize(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

function inScope(scope: string[] | null, propertyId: string | undefined): boolean {
  if (scope === null) return true;
  return Boolean(propertyId && scope.includes(propertyId));
}

function tenantPropertyIds(tenant: Tenant): string[] {
  const ids = new Set<string>(tenant.propertyIds ?? []);
  if (tenant.currentPropertyId) ids.add(tenant.currentPropertyId);
  return [...ids];
}

function tenantPropertyId(tenant: Tenant): string | undefined {
  return tenant.currentPropertyId ?? tenant.propertyIds?.[0];
}

/**
 * Payments with a property are scoped like every other finance record. A
 * payment that never matched a tenant has no property to scope by, so only
 * global readers can open it directly; the unmatched queue is the tool for
 * property-scoped finance staff.
 */
function assertPaymentAccess(actor: SessionUser, payment: Payment): void {
  if (payment.propertyId) {
    assertPropertyAccess(actor, payment.propertyId);
    return;
  }

  if (scopePropertyIds(actor) !== null) {
    throw new ServiceError(
      "forbidden",
      "This payment is not matched to a property. Use the unmatched queue to review it.",
    );
  }
}

function assertTenantAccess(actor: SessionUser, tenant: Tenant): void {
  const scope = scopePropertyIds(actor);
  if (scope === null) return;

  const accessible = tenantPropertyIds(tenant).some((id) => scope.includes(id));
  if (!accessible) {
    throw new ServiceError(
      "forbidden",
      "This tenant is outside the properties you can manage.",
    );
  }
}

function reversalIdFor(paymentId: string): string {
  return `rev_${paymentId}`;
}

function generatedManualReference(receivedAt: Date): string {
  return `MAN-${toDateInput(receivedAt).replace(/-/g, "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
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
      .collection(TENANT_COLLECTION)
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

async function decorate(docs: DocumentSnapshot[]): Promise<PaymentListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as Payment }));

  const [propertyNames, tenants, staffNames] = await Promise.all([
    getPropertyNames(rows.map((row) => row.data.propertyId ?? "")),
    tenantsById(rows.map((row) => row.data.tenantId ?? "")),
    getStaffNames(
      rows.flatMap((row) => [
        row.data.confirmedBy ?? "",
        row.data.reversedBy ?? "",
      ]),
    ),
  ]);

  return rows.map(({ id, data }) => {
    const tenant = data.tenantId ? tenants[data.tenantId] : undefined;
    return {
      id,
      provider: data.provider,
      providerTransactionId: data.providerTransactionId,
      amountMinor: data.amountMinor ?? 0,
      currency: data.currency ?? "KES",
      tenantId: data.tenantId,
      tenantName: tenant?.name,
      tenantPhone: tenant?.phone,
      leaseId: data.leaseId,
      propertyId: data.propertyId,
      propertyName: data.propertyId
        ? propertyNames[data.propertyId] ?? data.propertyId
        : undefined,
      status: data.status,
      source: data.source,
      bankCode: data.bankCode,
      narration: data.narration,
      payerName: data.payerName,
      payerPhone: data.payerPhone,
      allocatedMinor: data.allocatedMinor ?? 0,
      creditAddedMinor: data.creditAddedMinor ?? 0,
      reversalOfPaymentId: data.reversalOfPaymentId,
      reversalReason: data.reversalReason,
      receivedAt: toIsoString(data.receivedAt) ?? "",
      confirmedAt: toIsoString(data.confirmedAt),
      confirmedByName: data.confirmedBy
        ? staffNames[data.confirmedBy] ?? data.confirmedBy
        : undefined,
      reversedAt: toIsoString(data.reversedAt),
      reversedByName: data.reversedBy
        ? staffNames[data.reversedBy] ?? data.reversedBy
        : undefined,
      createdAt: toIsoString(data.createdAt) ?? "",
      updatedAt: toIsoString(data.updatedAt) ?? "",
    } satisfies PaymentListItem;
  });
}

export async function listPayments(
  actor: SessionUser,
  params: ListPaymentsParams = {},
): Promise<PageResult<PaymentListItem>> {
  assertCapability(actor, "view_financials");

  const scope = scopePropertyIds(actor);
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const status =
    params.status && params.status !== "all" ? params.status : undefined;
  const provider =
    params.provider && params.provider !== "all" ? params.provider : undefined;

  const db = adminDb();
  let base = db.collection(COLLECTION).orderBy("receivedAt", "desc");
  let scopeFallback: string[] | null = null;

  if (params.propertyId) {
    base = base.where("propertyId", "==", params.propertyId);
  } else if (scope) {
    if (scope.length <= 30) {
      base = base.where("propertyId", "in", scope);
    } else {
      scopeFallback = scope;
    }
  }

  // Status, provider and free text cannot be combined with cursor pagination
  // without an index for every permutation. They run over the recent window
  // instead and deliberately return no next cursor.
  const inMemory = Boolean(q || status || provider || scopeFallback);

  if (inMemory) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeFallback) {
      rows = rows.filter((row) => inScope(scopeFallback, row.propertyId));
    }
    if (status) rows = rows.filter((row) => row.status === status);
    if (provider) rows = rows.filter((row) => row.provider === provider);
    if (q) {
      const digits = q.replace(/\D/g, "").replace(/^0+/, "");
      rows = rows.filter(
        (row) =>
          row.providerTransactionId.toLowerCase().includes(q) ||
          (row.tenantName ?? "").toLowerCase().includes(q) ||
          (row.propertyName ?? "").toLowerCase().includes(q) ||
          (row.payerName ?? "").toLowerCase().includes(q) ||
          (row.narration ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 &&
            (row.payerPhone ?? "").replace(/\D/g, "").includes(digits)),
      );
    }
    return { items: rows, nextCursor: null };
  }

  let query = base;
  if (params.cursor) {
    const cursor = await db.collection(COLLECTION).doc(params.cursor).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snapshot = await query.limit(pageSize + 1).get();
  let docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  return {
    items: await decorate(docs),
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

async function allocationsForPayment(
  paymentId: string,
): Promise<PaymentAllocationLine[]> {
  const db = adminDb();
  const snapshot = await db
    .collection(ALLOCATION_COLLECTION)
    .where("paymentId", "==", paymentId)
    .orderBy("createdAt", "asc")
    .get();

  if (snapshot.empty) return [];

  const allocations = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as PaymentAllocation,
  }));

  const invoices: Record<string, Invoice> = {};
  for (const chunk of chunkIn(allocations.map((row) => row.data.invoiceId))) {
    const invoiceSnapshot = await db
      .collection(INVOICE_COLLECTION)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    invoiceSnapshot.docs.forEach((doc) => {
      invoices[doc.id] = doc.data() as Invoice;
    });
  }

  const lines = allocations.map(({ id, data }) => {
    const invoice = invoices[data.invoiceId];
    return {
      id,
      invoiceId: data.invoiceId,
      periodKey: invoice?.periodKey ?? "",
      periodLabel: invoice ? periodLabel(invoice.periodKey) : data.invoiceId,
      dueDate: toIsoString(invoice?.dueDate) ?? "",
      amountMinor: data.amountMinor,
      createdAt: toIsoString(data.createdAt) ?? "",
    } satisfies PaymentAllocationLine;
  });

  // All allocations of one payment share a server timestamp, so the stored
  // createdAt cannot distinguish them. Show them in the order the money was
  // applied: oldest due date first.
  return lines.sort((a, b) => {
    const byDueDate = a.dueDate.localeCompare(b.dueDate);
    if (byDueDate !== 0) return byDueDate;
    return a.invoiceId.localeCompare(b.invoiceId);
  });
}

export async function getPayment(
  actor: SessionUser,
  paymentId: string,
): Promise<PaymentDetail> {
  assertCapability(actor, "view_financials");

  const snapshot = await adminDb().collection(COLLECTION).doc(paymentId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Payment not found.");
  }

  const payment = snapshot.data() as Payment;
  assertPaymentAccess(actor, payment);

  const [item, allocations, reversal] = await Promise.all([
    decorate([snapshot]),
    allocationsForPayment(paymentId),
    payment.status === "reversed"
      ? adminDb()
          .collection(COLLECTION)
          .where("reversalOfPaymentId", "==", paymentId)
          .limit(1)
          .get()
      : Promise.resolve(null),
  ]);

  return {
    ...item[0],
    allocations,
    reversalPaymentId: reversal?.docs[0]?.id,
  };
}

export interface ConfirmedPaymentInput {
  provider: PaymentProvider;
  /** Normalised provider reference; the idempotency key. */
  providerTransactionId: string;
  amountMinor: number;
  receivedAt: Date;
  tenantId: string;
  source: PaymentSource;
  bankCode?: string;
  narration?: string;
  payerName?: string;
  payerPhone?: string;
  /** Audit verb. Statement imports log `payment.imported`. */
  auditAction?: "payment.recorded" | "payment.imported";
  /** Return a duplicate marker instead of throwing. Used by bulk imports. */
  ignoreDuplicate?: boolean;
}

export interface PaymentWriteResult {
  paymentId: string;
  /** True when the deterministic id already existed and nothing was written. */
  duplicate: boolean;
  allocatedMinor: number;
  creditAddedMinor: number;
}

/**
 * Record a confirmed receipt against a tenant and allocate it to that tenant's
 * oldest invoices in one transaction. Shared by manual entry and statement
 * imports so both paths allocate identically.
 *
 * The payment doc id is derived from provider + reference, so a retried
 * callback or a re-imported file can never record the same money twice.
 */
export async function recordConfirmedPayment(
  actor: SessionUser,
  input: ConfirmedPaymentInput,
): Promise<PaymentWriteResult> {
  assertCapability(actor, "reconcile_payments");

  const result = await adminDb().runTransaction((tx) =>
    confirmPaymentWithinTransaction(tx, actor, input),
  );

  // The transaction always runs the callback once, so `result` is set.
  return result as PaymentWriteResult;
}

/**
 * The transaction body underlying `recordConfirmedPayment`. Exposed so webhook
 * ingestion can commit the payment together with its raw provider event and
 * audit trail without re-implementing the money path.
 *
 * Callers must already hold a Firestore transaction and the actor must already
 * have passed their capability checks.
 */
export async function confirmPaymentWithinTransaction(
  tx: Transaction,
  actor: SessionUser,
  input: ConfirmedPaymentInput,
): Promise<PaymentWriteResult | undefined> {
  const paymentId = paymentIdForReference(
    input.provider,
    input.providerTransactionId,
  );

  const db = adminDb();
  const paymentRef = db.collection(COLLECTION).doc(paymentId);
  const tenantRef = db.collection(TENANT_COLLECTION).doc(input.tenantId);

  let result: PaymentWriteResult | undefined;

  const existing = await tx.get(paymentRef);
  if (existing.exists) {
    if (input.ignoreDuplicate) {
      result = {
        paymentId,
        duplicate: true,
        allocatedMinor: 0,
        creditAddedMinor: 0,
      };
      return result;
    }
    throw new ServiceError(
      "conflict",
      "That reference has already been recorded. Open the existing payment instead.",
    );
  }

  const tenantSnapshot = await tx.get(tenantRef);
  if (!tenantSnapshot.exists) {
    throw new ServiceError("not_found", "That tenant no longer exists.");
  }
  const tenant = tenantSnapshot.data() as Tenant;
  assertTenantAccess(actor, tenant);

  const propertyId = tenantPropertyId(tenant);
  if (!propertyId) {
    throw new ServiceError(
      "validation",
      "This tenant is not linked to a property. Add them to a property first.",
    );
  }

  // All reads happen before any write: the allocation engine reads the
  // tenant, open invoices and prior allocations, then updates them.
  const allocation = await allocateWithinTransaction(tx, actor, {
    paymentId,
    tenantId: input.tenantId,
    amountMinor: input.amountMinor,
  });

  tx.set(paymentRef, {
    provider: input.provider,
    providerTransactionId: input.providerTransactionId,
    amountMinor: input.amountMinor,
    currency: "KES",
    tenantId: input.tenantId,
    ...(tenant.currentLeaseId ? { leaseId: tenant.currentLeaseId } : {}),
    propertyId,
    status: "allocated" satisfies PaymentStatus,
    source: input.source,
    ...(input.bankCode ? { bankCode: input.bankCode } : {}),
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.payerName ? { payerName: input.payerName } : {}),
    ...(input.payerPhone ? { payerPhone: input.payerPhone } : {}),
    allocatedMinor: allocation.allocatedMinor,
    creditAddedMinor: allocation.creditAddedMinor,
    confirmedAt: FieldValue.serverTimestamp(),
    confirmedBy: actor.uid,
    receivedAt: Timestamp.fromDate(input.receivedAt),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // A queued receipt notification rides the same transaction; enqueue
  // failures are swallowed so money always lands first.
  if (tenant.consentSms === true && tenant.phoneE164) {
    enqueueSmsWithinTransaction(tx, {
      phoneE164: tenant.phoneE164,
      templateKey: "payment_receipt",
      reference: input.providerTransactionId,
      tenantName: tenant.fullName,
      dateInput: toDateInput(input.receivedAt),
      moneyMinor: input.amountMinor,
      requestedBy: actor.uid,
    });
  }

  writeAuditLog(tx, {
    actorUid: actor.uid,
    actorRole: actor.role,
    action: input.auditAction ?? "payment.recorded",
    entityType: "payment",
    entityId: paymentId,
    after: {
      provider: input.provider,
      providerTransactionId: input.providerTransactionId,
      amountMinor: input.amountMinor,
      tenantId: input.tenantId,
      propertyId,
      source: input.source,
      allocatedMinor: allocation.allocatedMinor,
      creditAddedMinor: allocation.creditAddedMinor,
    },
  });

  result = {
    paymentId,
    duplicate: false,
    allocatedMinor: allocation.allocatedMinor,
    creditAddedMinor: allocation.creditAddedMinor,
  };

  return result;
}

export interface UnmatchedPaymentInput {
  provider: PaymentProvider;
  providerTransactionId: string;
  amountMinor: number;
  receivedAt: Date;
  source: PaymentSource;
  /** Why no tenant was chosen. Shown to whoever reviews the queue. */
  reason: string;
  candidateTenantIds?: string[];
  bankCode?: string;
  narration?: string;
  payerName?: string;
  payerPhone?: string;
  ignoreDuplicate?: boolean;
}

export interface QueuedPaymentResult {
  paymentId: string;
  unmatchedId: string;
  duplicate: boolean;
}

/**
 * Park a receipt in the unmatched queue without guessing an owner. No tenant or
 * property is written, which is why the queue deliberately sits outside
 * property scope.
 */
export async function recordUnmatchedPayment(
  actor: SessionUser,
  input: UnmatchedPaymentInput,
): Promise<QueuedPaymentResult> {
  assertCapability(actor, "reconcile_payments");

  return adminDb().runTransaction((tx) =>
    queueUnmatchedWithinTransaction(tx, actor, input),
  );
}

/**
 * The transaction body underlying `recordUnmatchedPayment`. Exposed so webhook
 * ingestion can queue a receipt together with its raw provider event in one
 * transaction.
 */
export async function queueUnmatchedWithinTransaction(
  tx: Transaction,
  actor: SessionUser,
  input: UnmatchedPaymentInput,
): Promise<QueuedPaymentResult> {
  const paymentId = paymentIdForReference(
    input.provider,
    input.providerTransactionId,
  );
  const unmatchedId = `unm_${paymentId}`;

  const db = adminDb();
  const paymentRef = db.collection(COLLECTION).doc(paymentId);
  const unmatchedRef = db.collection(UNMATCHED_COLLECTION).doc(unmatchedId);

  let result: QueuedPaymentResult | undefined;

  const existing = await tx.get(paymentRef);
  if (existing.exists) {
    if (input.ignoreDuplicate) {
      result = { paymentId, unmatchedId, duplicate: true };
      return result;
    }
    throw new ServiceError(
      "conflict",
      "That reference has already been recorded. Open the existing payment instead.",
    );
  }

  tx.set(paymentRef, {
    provider: input.provider,
    providerTransactionId: input.providerTransactionId,
    amountMinor: input.amountMinor,
    currency: "KES",
    status: "unmatched" satisfies PaymentStatus,
    source: input.source,
    ...(input.bankCode ? { bankCode: input.bankCode } : {}),
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.payerName ? { payerName: input.payerName } : {}),
    ...(input.payerPhone ? { payerPhone: input.payerPhone } : {}),
    receivedAt: Timestamp.fromDate(input.receivedAt),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  tx.set(unmatchedRef, {
    paymentId,
    candidateTenantIds: input.candidateTenantIds ?? [],
    reason: input.reason,
    reviewStatus: "pending" satisfies ReviewStatus,
    createdAt: FieldValue.serverTimestamp(),
  });

  writeAuditLog(tx, {
    actorUid: actor.uid,
    actorRole: actor.role,
    action: "payment.queued_unmatched",
    entityType: "payment",
    entityId: paymentId,
    after: {
      provider: input.provider,
      providerTransactionId: input.providerTransactionId,
      amountMinor: input.amountMinor,
      source: input.source,
      reason: input.reason,
    },
  });

  result = { paymentId, unmatchedId, duplicate: false };
  return result;
}

/**
 * Record a receipt finance has already seen on a statement, then allocate it to
 * the tenant's oldest invoices in the same transaction. A duplicate reference
 * is rejected by the deterministic doc id, never silently merged.
 */
export async function recordManualReceipt(
  actor: SessionUser,
  input: ManualReceiptInput,
): Promise<string> {
  assertCapability(actor, "enter_manual_receipts");
  assertCapability(actor, "reconcile_payments");

  if (!referenceOptional(input.provider) && !input.providerTransactionId) {
    throw new ServiceError(
      "validation",
      "This provider needs a transaction reference.",
      {
        fieldErrors: {
          providerTransactionId: ["Enter the provider transaction reference."],
        },
      },
    );
  }

  // Cash receipts have no external reference; generate one so every payment
  // still has a stable, human-readable identity.
  const reference =
    input.providerTransactionId ?? generatedManualReference(input.receivedAt);

  const result = await recordConfirmedPayment(actor, {
    provider: input.provider,
    providerTransactionId: reference,
    amountMinor: input.amount,
    receivedAt: input.receivedAt,
    tenantId: input.tenantId,
    source: "manual",
    ...(input.bankCode ? { bankCode: input.bankCode } : {}),
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.payerName ? { payerName: input.payerName } : {}),
    ...(input.payerPhone ? { payerPhone: input.payerPhone } : {}),
  });

  return result.paymentId;
}

interface InvoiceReversal {
  id: string;
  invoice: Invoice;
  amountMinor: number;
}

/**
 * Reverse an allocated payment by appending compensating entries.
 *
 * The original payment and its allocations are never edited or deleted. A new
 * `reversal` payment row carries the negative total, negative allocation rows
 * restore each invoice, and any credit that is still untouched is removed from
 * the tenant. Already-spent credit blocks the reversal.
 */
export async function reversePayment(
  actor: SessionUser,
  paymentId: string,
  reason: string,
): Promise<string> {
  assertCapability(actor, "approve_reversals");

  const db = adminDb();
  const paymentRef = db.collection(COLLECTION).doc(paymentId);
  const reversalId = reversalIdFor(paymentId);

  await db.runTransaction(async (tx) => {
    const paymentSnapshot = await tx.get(paymentRef);
    if (!paymentSnapshot.exists) {
      throw new ServiceError("not_found", "Payment not found.");
    }

    const payment = paymentSnapshot.data() as Payment;
    assertPaymentAccess(actor, payment);

    if (payment.status === "reversal" || payment.reversalOfPaymentId) {
      throw new ServiceError(
        "conflict",
        "A reversal entry cannot itself be reversed.",
      );
    }
    if (payment.status === "reversed") {
      throw new ServiceError("conflict", "This payment is already reversed.");
    }
    if (payment.status === "unmatched" || payment.status === "rejected") {
      throw new ServiceError(
        "conflict",
        "This payment was never allocated. Resolve or ignore it in the unmatched queue instead.",
      );
    }

    const [existingReversal, allocationSnapshot, tenantSnapshot] =
      await Promise.all([
        tx.get(
          db
            .collection(COLLECTION)
            .where("reversalOfPaymentId", "==", paymentId)
            .limit(1),
        ),
        tx.get(
          db
            .collection(ALLOCATION_COLLECTION)
            .where("paymentId", "==", paymentId),
        ),
        payment.tenantId
          ? tx.get(db.collection(TENANT_COLLECTION).doc(payment.tenantId))
          : Promise.resolve(null),
      ]);

    if (!existingReversal.empty) {
      throw new ServiceError("conflict", "This payment is already reversed.");
    }

    const tenant =
      tenantSnapshot?.exists === true
        ? (tenantSnapshot.data() as Tenant)
        : undefined;

    const creditAddedMinor = payment.creditAddedMinor ?? 0;
    if (creditAddedMinor > 0) {
      const available = tenant?.creditBalanceMinor ?? 0;
      if (!tenant || available < creditAddedMinor) {
        throw new ServiceError(
          "conflict",
          "Part of this overpayment has already been applied to another invoice. Adjust those invoices before reversing.",
        );
      }
    }

    const invoiceSnapshots = await Promise.all(
      allocationSnapshot.docs.map((doc) =>
        tx.get(
          db
            .collection(INVOICE_COLLECTION)
            .doc((doc.data() as PaymentAllocation).invoiceId),
        ),
      ),
    );

    const reversals: InvoiceReversal[] = allocationSnapshot.docs.map(
      (doc, index) => {
        const allocation = doc.data() as PaymentAllocation;
        const snapshot = invoiceSnapshots[index];
        if (!snapshot.exists) {
          throw new ServiceError(
            "conflict",
            "An invoice in this payment no longer exists, so the ledger cannot be reversed cleanly.",
          );
        }
        const invoice = snapshot.data() as Invoice;
        if (invoice.status === "void") {
          throw new ServiceError(
            "conflict",
            "An invoice in this payment is void. Restore it before reversing.",
          );
        }
        return {
          id: allocation.invoiceId,
          invoice,
          amountMinor: allocation.amountMinor,
        };
      },
    );

    const allocatedTotal = reversals.reduce(
      (total, line) => total + line.amountMinor,
      0,
    );
    const reversedAmountMinor = allocatedTotal + creditAddedMinor;
    if (reversedAmountMinor <= 0) {
      throw new ServiceError(
        "conflict",
        "This payment has no allocated money to reverse.",
      );
    }

    // Writes start here. Every read above is complete.
    tx.create(db.collection(COLLECTION).doc(reversalId), {
      provider: payment.provider,
      providerTransactionId: `REV-${payment.providerTransactionId}`,
      amountMinor: -reversedAmountMinor,
      currency: payment.currency ?? "KES",
      ...(payment.tenantId ? { tenantId: payment.tenantId } : {}),
      ...(payment.leaseId ? { leaseId: payment.leaseId } : {}),
      ...(payment.propertyId ? { propertyId: payment.propertyId } : {}),
      status: "reversal" satisfies PaymentStatus,
      source: "manual",
      allocatedMinor: 0 - allocatedTotal,
      // `0 - 0` keeps a zero credit as +0 instead of the confusing -0.
      creditAddedMinor: 0 - creditAddedMinor,
      reversalOfPaymentId: paymentId,
      reversalReason: reason,
      ...(payment.payerName ? { payerName: payment.payerName } : {}),
      ...(payment.payerPhone ? { payerPhone: payment.payerPhone } : {}),
      ...(payment.narration ? { narration: payment.narration } : {}),
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: actor.uid,
      receivedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    for (const line of reversals) {
      tx.create(
        db
          .collection(ALLOCATION_COLLECTION)
          .doc(`${reversalId}_${line.id}`),
        {
          paymentId: reversalId,
          invoiceId: line.id,
          amountMinor: -line.amountMinor,
          createdBy: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
        },
      );

      const amountPaidMinor = Math.max(
        0,
        line.invoice.amountPaidMinor - line.amountMinor,
      );
      tx.update(db.collection(INVOICE_COLLECTION).doc(line.id), {
        amountPaidMinor,
        balanceMinor: Math.max(0, line.invoice.amountDueMinor - amountPaidMinor),
        status: statusForBalance(
          line.invoice.amountDueMinor,
          amountPaidMinor,
        ),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (creditAddedMinor > 0 && payment.tenantId) {
      tx.update(db.collection(TENANT_COLLECTION).doc(payment.tenantId), {
        creditBalanceMinor:
          (tenant?.creditBalanceMinor ?? 0) - creditAddedMinor,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeAuditLog(tx, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "tenant.credit_reversed",
        entityType: "tenant",
        entityId: payment.tenantId,
        before: { creditBalanceMinor: tenant?.creditBalanceMinor ?? 0 },
        after: {
          creditBalanceMinor:
            (tenant?.creditBalanceMinor ?? 0) - creditAddedMinor,
          removedMinor: creditAddedMinor,
        },
        reason: `Reversal of payment ${paymentId}`,
      });
    }

    tx.update(paymentRef, {
      status: "reversed" satisfies PaymentStatus,
      reversalReason: reason,
      reversedAt: FieldValue.serverTimestamp(),
      reversedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "payment.reversed",
      entityType: "payment",
      entityId: paymentId,
      before: {
        status: payment.status,
        amountMinor: payment.amountMinor,
        allocatedMinor: payment.allocatedMinor ?? 0,
        creditAddedMinor,
      },
      after: {
        status: "reversed",
        reversalPaymentId: reversalId,
        reversedAmountMinor,
      },
      reason,
    });
  });

  return reversalId;
}

interface UnmatchedRow {
  id: string;
  data: UnmatchedPayment;
}

async function decorateUnmatched(
  rows: UnmatchedRow[],
): Promise<UnmatchedPaymentListItem[]> {
  if (rows.length === 0) return [];

  const db = adminDb();
  const payments: Record<string, Payment> = {};
  for (const chunk of chunkIn(rows.map((row) => row.data.paymentId))) {
    const snapshot = await db
      .collection(COLLECTION)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      payments[doc.id] = doc.data() as Payment;
    });
  }

  const [candidateTenants, staffNames] = await Promise.all([
    tenantsById(
      rows.flatMap((row) => row.data.candidateTenantIds ?? []),
    ),
    getStaffNames(rows.map((row) => row.data.reviewedBy ?? "")),
  ]);

  return rows.map(({ id, data }) => {
    const payment = payments[data.paymentId];
    const candidates = data.candidateTenantIds ?? [];
    return {
      id,
      paymentId: data.paymentId,
      amountMinor: payment?.amountMinor ?? 0,
      currency: payment?.currency ?? "KES",
      provider: payment?.provider ?? "manual",
      providerTransactionId:
        payment?.providerTransactionId ?? data.paymentId,
      payerName: payment?.payerName,
      payerPhone: payment?.payerPhone,
      narration: payment?.narration,
      receivedAt: toIsoString(payment?.receivedAt) ?? "",
      candidateTenantIds: candidates,
      candidateTenantNames: candidates.map(
        (tenantId) => candidateTenants[tenantId]?.name ?? tenantId,
      ),
      reason: data.reason,
      reviewStatus: data.reviewStatus,
      resolutionNote: data.resolutionNote,
      reviewedByName: data.reviewedBy
        ? staffNames[data.reviewedBy] ?? data.reviewedBy
        : undefined,
      reviewedAt: toIsoString(data.reviewedAt),
      createdAt: toIsoString(data.createdAt) ?? "",
    } satisfies UnmatchedPaymentListItem;
  });
}

/** Count of payments still waiting for a human decision. */
export async function countOpenUnmatched(actor: SessionUser): Promise<number> {
  assertCapability(actor, "reconcile_payments");

  const snapshot = await adminDb()
    .collection(UNMATCHED_COLLECTION)
    .where("reviewStatus", "in", ["pending", "assigned"])
    .count()
    .get();

  return snapshot.data().count;
}

/**
 * The unmatched queue is intentionally not property-scoped: an unknown payer
 * has no property yet. Access is limited to holders of `reconcile_payments`
 * (admin and finance), and matching a row to a tenant is still checked against
 * the actor's property scope.
 */
export async function listUnmatched(
  actor: SessionUser,
  params: ListUnmatchedParams = {},
): Promise<PageResult<UnmatchedPaymentListItem>> {
  assertCapability(actor, "reconcile_payments");

  const pageSize = clampPageSize(params.pageSize);
  const status = params.status ?? "open";

  const snapshot = await adminDb()
    .collection(UNMATCHED_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(Math.max(pageSize, SEARCH_LIMIT))
    .get();

  let items = await decorateUnmatched(
    snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as UnmatchedPayment,
    })),
  );

  if (status === "open") {
    items = items.filter(
      (item) =>
        item.reviewStatus === "pending" || item.reviewStatus === "assigned",
    );
  } else if (status !== "all") {
    items = items.filter((item) => item.reviewStatus === status);
  }

  return { items: items.slice(0, pageSize), nextCursor: null };
}

export async function resolveUnmatched(
  actor: SessionUser,
  unmatchedId: string,
  input: UnmatchedResolveInput,
): Promise<string> {
  assertCapability(actor, "reconcile_payments");

  const db = adminDb();
  const unmatchedRef = db.collection(UNMATCHED_COLLECTION).doc(unmatchedId);

  let paymentId = "";

  await db.runTransaction(async (tx) => {
    const unmatchedSnapshot = await tx.get(unmatchedRef);
    if (!unmatchedSnapshot.exists) {
      throw new ServiceError("not_found", "Unmatched payment not found.");
    }
    const unmatched = unmatchedSnapshot.data() as UnmatchedPayment;
    if (unmatched.reviewStatus === "resolved") {
      throw new ServiceError("conflict", "This payment is already matched.");
    }
    if (unmatched.reviewStatus === "ignored") {
      throw new ServiceError("conflict", "This payment was ignored.");
    }

    paymentId = unmatched.paymentId;
    const paymentRef = db.collection(COLLECTION).doc(paymentId);
    const paymentSnapshot = await tx.get(paymentRef);
    if (!paymentSnapshot.exists) {
      throw new ServiceError("not_found", "Payment not found.");
    }
    const payment = paymentSnapshot.data() as Payment;
    if (payment.status !== "unmatched") {
      throw new ServiceError(
        "conflict",
        "This payment has already been processed.",
      );
    }

    const tenantRef = db.collection(TENANT_COLLECTION).doc(input.tenantId);
    const tenantSnapshot = await tx.get(tenantRef);
    if (!tenantSnapshot.exists) {
      throw new ServiceError("not_found", "That tenant no longer exists.");
    }
    const tenant = tenantSnapshot.data() as Tenant;
    assertTenantAccess(actor, tenant);

    const propertyId = tenantPropertyId(tenant);
    if (!propertyId) {
      throw new ServiceError(
        "validation",
        "That tenant is not linked to a property.",
      );
    }

    const allocation = await allocateWithinTransaction(tx, actor, {
      paymentId,
      tenantId: input.tenantId,
      amountMinor: payment.amountMinor,
    });

    tx.update(paymentRef, {
      status: "allocated" satisfies PaymentStatus,
      tenantId: input.tenantId,
      ...(tenant.currentLeaseId ? { leaseId: tenant.currentLeaseId } : {}),
      propertyId,
      allocatedMinor: allocation.allocatedMinor,
      creditAddedMinor: allocation.creditAddedMinor,
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(unmatchedRef, {
      reviewStatus: "resolved" satisfies ReviewStatus,
      reviewedBy: actor.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      ...(input.note
        ? { resolutionNote: input.note }
        : { resolutionNote: `Matched to tenant ${tenant.fullName}.` }),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unmatched.resolved",
      entityType: "unmatchedPayment",
      entityId: unmatchedId,
      after: {
        paymentId,
        tenantId: input.tenantId,
        propertyId,
        allocatedMinor: allocation.allocatedMinor,
        creditAddedMinor: allocation.creditAddedMinor,
      },
      reason: input.note,
    });
  });

  return paymentId;
}

export async function ignoreUnmatched(
  actor: SessionUser,
  unmatchedId: string,
  input: UnmatchedIgnoreInput,
): Promise<void> {
  assertCapability(actor, "reconcile_payments");

  const db = adminDb();
  const ref = db.collection(UNMATCHED_COLLECTION).doc(unmatchedId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Unmatched payment not found.");
    }
    const row = snapshot.data() as UnmatchedPayment;
    if (row.reviewStatus === "resolved") {
      throw new ServiceError("conflict", "This payment is already matched.");
    }
    if (row.reviewStatus === "ignored") {
      throw new ServiceError("conflict", "This payment was already ignored.");
    }

    tx.update(ref, {
      reviewStatus: "ignored" satisfies ReviewStatus,
      reviewedBy: actor.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      resolutionNote: input.reason,
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unmatched.ignored",
      entityType: "unmatchedPayment",
      entityId: unmatchedId,
      after: { paymentId: row.paymentId, reviewStatus: "ignored" },
      reason: input.reason,
    });
  });
}
