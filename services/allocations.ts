import "server-only";

import {
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";

import { planAllocation } from "@/lib/allocation";
import { writeAuditLog } from "@/lib/audit";
import { assertCapability, scopePropertyIds } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { statusForBalance } from "@/lib/billing";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Invoice, MinorUnits, Tenant } from "@/lib/types";

const INVOICE_COLLECTION = "invoices";
const ALLOCATION_COLLECTION = "paymentAllocations";
const TENANT_COLLECTION = "tenants";

/** Only live invoices can receive money; void and paid ones are skipped. */
const ALLOCATABLE_STATUSES = ["open", "partial"] as const;

/** Bound the number of invoices one payment may be spread across. */
const MAX_ALLOCATABLE_INVOICES = 200;

export interface AllocationTarget {
  /** The confirmed payment being allocated. Also the idempotency key. */
  paymentId: string;
  tenantId: string;
  amountMinor: MinorUnits;
}

export interface AllocationLine {
  invoiceId: string;
  amountMinor: MinorUnits;
}

export interface AllocationResult {
  paymentId: string;
  tenantId: string;
  /** Money presented for allocation. */
  amountMinor: MinorUnits;
  allocatedMinor: MinorUnits;
  /** Surplus moved to the tenant's credit balance. */
  creditAddedMinor: MinorUnits;
  creditBalanceMinor: MinorUnits;
  allocations: AllocationLine[];
}

function validateTarget(target: AllocationTarget): void {
  if (!target.paymentId.trim()) {
    throw new ServiceError("validation", "A payment reference is required.");
  }
  if (!target.tenantId.trim()) {
    throw new ServiceError("validation", "A tenant is required.");
  }
  if (!Number.isInteger(target.amountMinor) || target.amountMinor <= 0) {
    throw new ServiceError("validation", "The payment amount must be positive.");
  }
}

function dueDateOf(invoice: Invoice): Date | string {
  const value = invoice.dueDate as unknown;
  if (value instanceof Date) return value;
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return "";
}

function tenantPropertyIds(tenant: Tenant): string[] {
  const ids = new Set<string>(tenant.propertyIds ?? []);
  if (tenant.currentPropertyId) ids.add(tenant.currentPropertyId);
  return [...ids];
}

/**
 * Allocate one payment inside an existing transaction.
 *
 * Callers must perform all of their own reads before calling this and must
 * allocate exactly once per confirmed payment. A second attempt for the same
 * `paymentId` is rejected: allocation documents are append-only, so a reversal
 * has to create compensating entries in a later phase rather than rewriting
 * history.
 *
 * Oldest due invoice wins. Any surplus becomes tenant credit, never a guess:
 * a payment that cannot be matched is expected to stay in the unmatched queue
 * instead of reaching this function.
 */
export async function allocateWithinTransaction(
  tx: Transaction,
  actor: SessionUser,
  target: AllocationTarget,
): Promise<AllocationResult> {
  assertCapability(actor, "reconcile_payments");
  validateTarget(target);

  const scope = scopePropertyIds(actor);
  const db = adminDb();

  const alreadyAllocated = await tx.get(
    db
      .collection(ALLOCATION_COLLECTION)
      .where("paymentId", "==", target.paymentId)
      .limit(1),
  );
  if (!alreadyAllocated.empty) {
    throw new ServiceError(
      "conflict",
      "This payment has already been allocated. Reverse it instead of allocating twice.",
    );
  }

  const tenantRef = db.collection(TENANT_COLLECTION).doc(target.tenantId);
  const tenantSnapshot = await tx.get(tenantRef);
  if (!tenantSnapshot.exists) {
    throw new ServiceError("not_found", "That tenant no longer exists.");
  }
  const tenant = tenantSnapshot.data() as Tenant;

  if (scope) {
    const inScope = tenantPropertyIds(tenant).some((id) => scope.includes(id));
    if (!inScope) {
      throw new ServiceError(
        "forbidden",
        "This tenant is outside the properties you can manage.",
      );
    }
  }

  const invoiceSnapshot = await tx.get(
    db
      .collection(INVOICE_COLLECTION)
      .where("tenantId", "==", target.tenantId)
      .where("status", "in", [...ALLOCATABLE_STATUSES])
      .orderBy("dueDate", "asc")
      .limit(MAX_ALLOCATABLE_INVOICES),
  );

  const candidates = invoiceSnapshot.docs
    .map((doc) => ({ id: doc.id, invoice: doc.data() as Invoice }))
    .filter(({ invoice }) => !scope || scope.includes(invoice.propertyId));

  const plan = planAllocation(
    candidates.map(({ id, invoice }) => ({
      id,
      dueDate: dueDateOf(invoice),
      balanceMinor: invoice.balanceMinor,
    })),
    target.amountMinor,
  );

  const byId = new Map(candidates.map((entry) => [entry.id, entry.invoice]));
  const allocations: AllocationLine[] = [];

  for (const line of plan.allocations) {
    const invoice = byId.get(line.invoiceId);
    if (!invoice) {
      // Unreachable: the plan is built from the same candidates. Fail loudly
      // rather than dropping money from the ledger.
      throw new ServiceError(
        "internal",
        "Allocation plan referenced an invoice that was not loaded.",
      );
    }

    const amountPaidMinor = invoice.amountPaidMinor + line.amountMinor;
    const balanceMinor = Math.max(0, invoice.amountDueMinor - amountPaidMinor);

    tx.set(
      db
        .collection(ALLOCATION_COLLECTION)
        .doc(`${target.paymentId}_${line.invoiceId}`),
      {
        paymentId: target.paymentId,
        invoiceId: line.invoiceId,
        amountMinor: line.amountMinor,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      },
    );

    tx.update(db.collection(INVOICE_COLLECTION).doc(line.invoiceId), {
      amountPaidMinor,
      balanceMinor,
      status: statusForBalance(invoice.amountDueMinor, amountPaidMinor),
      updatedAt: FieldValue.serverTimestamp(),
    });

    allocations.push({ ...line });
  }

  const previousCredit = tenant.creditBalanceMinor ?? 0;
  const creditAddedMinor = plan.remainderMinor;
  const creditBalanceMinor = previousCredit + creditAddedMinor;

  if (creditAddedMinor > 0) {
    tx.update(tenantRef, {
      creditBalanceMinor,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "tenant.credit_added",
      entityType: "tenant",
      entityId: target.tenantId,
      before: { creditBalanceMinor: previousCredit },
      after: { creditBalanceMinor, addedMinor: creditAddedMinor },
      reason: `Overpayment on payment ${target.paymentId}`,
    });
  }

  writeAuditLog(tx, {
    actorUid: actor.uid,
    actorRole: actor.role,
    action: "payment.allocated",
    entityType: "payment",
    entityId: target.paymentId,
    after: {
      tenantId: target.tenantId,
      amountMinor: target.amountMinor,
      allocatedMinor: plan.allocatedMinor,
      creditAddedMinor,
      invoices: allocations.map((line) => line.invoiceId),
    },
  });

  return {
    paymentId: target.paymentId,
    tenantId: target.tenantId,
    amountMinor: target.amountMinor,
    allocatedMinor: plan.allocatedMinor,
    creditAddedMinor,
    creditBalanceMinor,
    allocations,
  };
}

/**
 * Transaction wrapper for callers that are not already in one (manual
 * allocation in Phase 5, or a repair run). Payment ingestion should call
 * `allocateWithinTransaction` from its own transaction so the payment document
 * and its allocations commit together.
 */
export async function allocatePayment(
  actor: SessionUser,
  target: AllocationTarget,
): Promise<AllocationResult> {
  return adminDb().runTransaction((tx) =>
    allocateWithinTransaction(tx, actor, target),
  );
}
