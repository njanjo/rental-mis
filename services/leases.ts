import "server-only";

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import {
  assertCapability,
  assertPropertyAccess,
  chunkIn,
  hasGlobalScope,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { parseDateInput, todayIsoDate, toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Lease, LeaseStatus, Property, Tenant, Unit } from "@/lib/types";
import type { LeaseListItem, PageResult } from "@/lib/types/views";
import type {
  LeaseCreateInput,
  LeaseRenewInput,
  LeaseTerminateInput,
  LeaseTermsInput,
} from "@/lib/validation/lease";
import { getPropertyNames } from "@/services/properties";
import { assertTenantAccess, canAccessTenant } from "@/services/tenants";

const COLLECTION = "leases";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListLeasesParams {
  q?: string;
  propertyId?: string;
  status?: LeaseStatus | "all";
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

function buildQuery(
  scope: string[] | null,
  params: ListLeasesParams,
): { query: Query; scopeFallback: string[] | null } {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("startDate", "desc");
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

  if (params.status && params.status !== "all") {
    query = query.where("status", "==", params.status);
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
): Promise<Record<string, { unitNumber: string; propertyId: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const result: Record<string, { unitNumber: string; propertyId: string }> = {};

  for (const chunk of chunkIn(unique)) {
    const snapshot = await db
      .collection("units")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as Unit;
      result[doc.id] = {
        unitNumber: data.unitNumber ?? doc.id,
        propertyId: data.propertyId ?? "",
      };
    });
  }

  return result;
}

async function decorate(docs: QueryDocumentSnapshot[]): Promise<LeaseListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as Lease }));
  const [propertyNames, tenants, units] = await Promise.all([
    getPropertyNames(rows.map((row) => row.data.propertyId)),
    tenantsById(rows.map((row) => row.data.tenantId)),
    unitsById(rows.map((row) => row.data.unitId)),
  ]);

  return rows.map(({ id, data }) => {
    const tenant = tenants[data.tenantId];
    const unit = units[data.unitId];

    return {
      id,
      tenantId: data.tenantId,
      tenantName: tenant?.name ?? data.tenantId,
      tenantPhone: tenant?.phone,
      unitId: data.unitId,
      unitNumber: unit?.unitNumber ?? data.unitId,
      propertyId: data.propertyId,
      propertyName: propertyNames[data.propertyId] ?? data.propertyId,
      startDate: toIsoString(data.startDate) ?? "",
      endDate: toIsoString(data.endDate) ?? "",
      rentAmountMinor: data.rentAmountMinor ?? 0,
      depositAmountMinor: data.depositAmountMinor ?? 0,
      currency: data.currency ?? "KES",
      dueDay: data.dueDay,
      status: data.status,
      terminatedAt: toIsoString(data.terminatedAt),
      terminationReason: data.terminationReason,
      renewedFromLeaseId: data.renewedFromLeaseId,
      createdAt: toIsoString(data.createdAt) ?? "",
      updatedAt: toIsoString(data.updatedAt) ?? "",
    } satisfies LeaseListItem;
  });
}

export async function listLeases(
  actor: SessionUser,
  params: ListLeasesParams = {},
): Promise<PageResult<LeaseListItem>> {
  const scope = scopePropertyIds(actor);
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const { query: base, scopeFallback } = buildQuery(scope, params);

  if (q) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeFallback) {
      rows = rows.filter((row) => inScope(scopeFallback, row.propertyId));
    }
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    rows = rows.filter(
      (row) =>
        row.tenantName.toLowerCase().includes(q) ||
        row.unitNumber.toLowerCase().includes(q) ||
        row.propertyName.toLowerCase().includes(q) ||
        (digits.length >= 3 &&
          (row.tenantPhone ?? "").replace(/\D/g, "").includes(digits)),
    );
    return { items: rows, nextCursor: null };
  }

  const query = await applyCursor(base, params.cursor);
  const snapshot = await query.limit(pageSize + 1).get();
  let docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  let items = await decorate(docs);
  if (scopeFallback) {
    items = items.filter((row) => inScope(scopeFallback, row.propertyId));
  }

  return {
    items,
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

export async function getLease(
  actor: SessionUser,
  leaseId: string,
): Promise<LeaseListItem> {
  const snapshot = await adminDb().collection(COLLECTION).doc(leaseId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Lease not found.");
  }

  const lease = snapshot.data() as Lease;
  assertPropertyAccess(actor, lease.propertyId);

  const [item] = await decorate([snapshot as QueryDocumentSnapshot]);

  // Renewal chain: a lease can have at most one direct successor.
  const successor = await adminDb()
    .collection(COLLECTION)
    .where("renewedFromLeaseId", "==", leaseId)
    .limit(1)
    .get();
  const renewedToLeaseId = successor.empty ? undefined : successor.docs[0].id;

  return { ...item, renewedToLeaseId };
}

/** A tenant can hold one live tenancy; anything else must be renewed. */
function assertNoLiveTenancy(tenant: Tenant): void {
  if (tenant.currentLeaseId) {
    throw new ServiceError(
      "conflict",
      "This tenant already has an active lease. Renew or terminate it first.",
    );
  }
}

export async function createLease(
  actor: SessionUser,
  input: LeaseCreateInput,
): Promise<string> {
  assertCapability(actor, "manage_leases");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc();
  const unitRef = db.collection("units").doc(input.unitId);
  const tenantRef = db.collection("tenants").doc(input.tenantId);

  await db.runTransaction(async (tx) => {
    const unitSnapshot = await tx.get(unitRef);
    if (!unitSnapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }
    const unit = unitSnapshot.data() as Unit;
    assertPropertyAccess(actor, unit.propertyId);

    const tenantSnapshot = await tx.get(tenantRef);
    if (!tenantSnapshot.exists) {
      throw new ServiceError("not_found", "Tenant not found.");
    }
    const tenant = tenantSnapshot.data() as Tenant;
    assertTenantAccess(actor, tenant);

    const propertySnapshot = await tx.get(
      db.collection("properties").doc(unit.propertyId),
    );
    if (!propertySnapshot.exists) {
      throw new ServiceError("not_found", "Property not found.");
    }
    if (!(propertySnapshot.data() as Property).active) {
      throw new ServiceError(
        "conflict",
        "This property is archived. Restore it before starting a lease.",
      );
    }

    if (unit.active === false) {
      throw new ServiceError(
        "conflict",
        "This unit is archived. Restore it before starting a lease.",
      );
    }
    if (unit.status === "maintenance") {
      throw new ServiceError(
        "conflict",
        "This unit is under maintenance. Mark it vacant before starting a lease.",
      );
    }
    if (unit.activeLeaseId || unit.status === "occupied") {
      throw new ServiceError(
        "conflict",
        "This unit already has an occupant. Terminate or renew that lease first.",
        { fieldErrors: { unitId: ["This unit is not vacant."] } },
      );
    }

    if (tenant.status !== "active") {
      throw new ServiceError(
        "conflict",
        "This tenant is not active. Reactivate them before starting a lease.",
      );
    }
    assertNoLiveTenancy(tenant);

    const openLeases = await tx.get(
      db
        .collection(COLLECTION)
        .where("unitId", "==", input.unitId)
        .where("status", "in", ["pending", "active"])
        .limit(1),
    );
    if (!openLeases.empty) {
      throw new ServiceError(
        "conflict",
        "This unit already has an open lease. Cancel it before starting another.",
        { fieldErrors: { unitId: ["This unit already has an open lease."] } },
      );
    }

    tx.set(ref, {
      tenantId: input.tenantId,
      unitId: input.unitId,
      propertyId: unit.propertyId,
      startDate: Timestamp.fromDate(input.startDate),
      endDate: Timestamp.fromDate(input.endDate),
      rentAmountMinor: input.rentAmount,
      currency: "KES",
      dueDay: input.dueDay,
      depositAmountMinor: input.depositAmount,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The tenant is now associated with the property; lists and rules scope on
    // this array, so the lease must widen it in the same transaction.
    tx.update(tenantRef, {
      propertyIds: FieldValue.arrayUnion(unit.propertyId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "lease.created",
      entityType: "lease",
      entityId: ref.id,
      after: {
        tenantId: input.tenantId,
        unitId: input.unitId,
        propertyId: unit.propertyId,
        startDate: Timestamp.fromDate(input.startDate),
        endDate: Timestamp.fromDate(input.endDate),
        rentAmountMinor: input.rentAmount,
        depositAmountMinor: input.depositAmount,
        dueDay: input.dueDay,
        status: "pending",
      },
    });
  });

  return ref.id;
}

/**
 * Terms edits never touch dates, the tenant or the unit. On an active lease a
 * reason is mandatory and the change only affects invoices generated later.
 */
export async function updateLeaseTerms(
  actor: SessionUser,
  leaseId: string,
  input: LeaseTermsInput,
): Promise<void> {
  assertCapability(actor, "manage_leases");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(leaseId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Lease not found.");
    }

    const lease = snapshot.data() as Lease;
    assertPropertyAccess(actor, lease.propertyId);

    if (lease.status === "terminated" || lease.status === "expired") {
      throw new ServiceError(
        "conflict",
        `This lease is ${lease.status}. Its terms can no longer change.`,
      );
    }

    tx.update(ref, {
      rentAmountMinor: input.rentAmount,
      depositAmountMinor: input.depositAmount,
      dueDay: input.dueDay,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "lease.terms_updated",
      entityType: "lease",
      entityId: leaseId,
      before: {
        rentAmountMinor: lease.rentAmountMinor,
        depositAmountMinor: lease.depositAmountMinor,
        dueDay: lease.dueDay,
      },
      after: {
        rentAmountMinor: input.rentAmount,
        depositAmountMinor: input.depositAmount,
        dueDay: input.dueDay,
      },
      reason: input.reason,
    });
  });
}

export async function activateLease(
  actor: SessionUser,
  leaseId: string,
): Promise<void> {
  assertCapability(actor, "manage_leases");

  const db = adminDb();
  const leaseRef = db.collection(COLLECTION).doc(leaseId);

  await db.runTransaction(async (tx) => {
    const leaseSnapshot = await tx.get(leaseRef);
    if (!leaseSnapshot.exists) {
      throw new ServiceError("not_found", "Lease not found.");
    }

    const lease = leaseSnapshot.data() as Lease;
    assertPropertyAccess(actor, lease.propertyId);

    if (lease.status !== "pending") {
      throw new ServiceError(
        "conflict",
        `Only a pending lease can be activated. This one is ${lease.status}.`,
      );
    }

    const today = parseDateInput(todayIsoDate());
    if (!today) {
      throw new ServiceError("internal", "Could not resolve today's date.");
    }
    if (lease.startDate.toDate().getTime() > today.getTime()) {
      throw new ServiceError(
        "conflict",
        "This lease starts in the future. Activate it on or after the start date.",
      );
    }
    if (lease.endDate.toDate().getTime() < today.getTime()) {
      throw new ServiceError(
        "conflict",
        "This lease's term has already ended. Create a new lease instead.",
      );
    }

    const unitRef = db.collection("units").doc(lease.unitId);
    const tenantRef = db.collection("tenants").doc(lease.tenantId);
    const previousRef = lease.renewedFromLeaseId
      ? db.collection(COLLECTION).doc(lease.renewedFromLeaseId)
      : null;

    const unitSnapshot = await tx.get(unitRef);
    if (!unitSnapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }
    const unit = unitSnapshot.data() as Unit;
    if (unit.propertyId !== lease.propertyId) {
      throw new ServiceError(
        "conflict",
        "This lease no longer matches its unit. Recreate the lease.",
      );
    }
    if (unit.active === false) {
      throw new ServiceError(
        "conflict",
        "This unit is archived. Restore it before activating the lease.",
      );
    }

    const tenantSnapshot = await tx.get(tenantRef);
    if (!tenantSnapshot.exists) {
      throw new ServiceError("not_found", "Tenant not found.");
    }
    const tenant = tenantSnapshot.data() as Tenant;
    if (!canAccessTenant(actor, tenant)) {
      throw new ServiceError("forbidden", "You do not have access to this tenant.");
    }
    if (tenant.status !== "active") {
      throw new ServiceError(
        "conflict",
        "This tenant is not active. Reactivate them before activating the lease.",
      );
    }

    const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
    const previous =
      previousSnapshot?.exists ? (previousSnapshot.data() as Lease) : null;
    const replacedLeaseId =
      previous?.status === "active" ? previousSnapshot?.id : undefined;

    // A renewal boots the previous lease out at the same instant. Anything else
    // holding the unit or the tenant is a genuine conflict.
    if (unit.activeLeaseId && unit.activeLeaseId !== replacedLeaseId) {
      throw new ServiceError(
        "conflict",
        "This unit is occupied by another lease. Terminate it first.",
      );
    }
    if (unit.status === "occupied" && !unit.activeLeaseId) {
      throw new ServiceError(
        "conflict",
        "This unit is marked occupied without a lease. Correct the unit first.",
      );
    }
    if (unit.status === "maintenance") {
      throw new ServiceError(
        "conflict",
        "This unit is under maintenance. Mark it vacant before activating the lease.",
      );
    }
    if (tenant.currentLeaseId && tenant.currentLeaseId !== replacedLeaseId) {
      throw new ServiceError(
        "conflict",
        "This tenant already has an active lease. Terminate it first.",
      );
    }

    tx.update(leaseRef, {
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(unitRef, {
      status: "occupied",
      activeLeaseId: leaseId,
      activeTenantId: lease.tenantId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(tenantRef, {
      currentLeaseId: leaseId,
      currentUnitId: lease.unitId,
      currentPropertyId: lease.propertyId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (previousRef && previousSnapshot?.exists && replacedLeaseId) {
      tx.update(previousRef, {
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
      });

      writeAuditLog(tx, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "lease.expired",
        entityType: "lease",
        entityId: replacedLeaseId,
        before: { status: "active" },
        after: { status: "expired" },
        reason: `Renewed by lease ${leaseId}.`,
      });
    }

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "lease.activated",
      entityType: "lease",
      entityId: leaseId,
      before: { status: "pending" },
      after: {
        status: "active",
        unitId: lease.unitId,
        tenantId: lease.tenantId,
      },
    });
  });
}

export async function terminateLease(
  actor: SessionUser,
  leaseId: string,
  input: LeaseTerminateInput,
): Promise<void> {
  assertCapability(actor, "manage_leases");

  const db = adminDb();
  const leaseRef = db.collection(COLLECTION).doc(leaseId);

  await db.runTransaction(async (tx) => {
    const leaseSnapshot = await tx.get(leaseRef);
    if (!leaseSnapshot.exists) {
      throw new ServiceError("not_found", "Lease not found.");
    }

    const lease = leaseSnapshot.data() as Lease;
    assertPropertyAccess(actor, lease.propertyId);

    if (lease.status !== "pending" && lease.status !== "active") {
      throw new ServiceError(
        "conflict",
        `This lease is already ${lease.status}.`,
      );
    }

    let endDate: Timestamp = Timestamp.fromDate(lease.endDate.toDate());
    if (input.endDate) {
      if (input.endDate.getTime() < lease.startDate.toDate().getTime()) {
        throw new ServiceError(
          "validation",
          "The end date cannot be before the lease started.",
          { fieldErrors: { endDate: ["Choose a date on or after the start date."] } },
        );
      }
      if (input.endDate.getTime() > lease.endDate.toDate().getTime()) {
        throw new ServiceError(
          "validation",
          "The end date cannot be later than the agreed end date.",
          { fieldErrors: { endDate: ["Choose a date on or before the current end date."] } },
        );
      }
      endDate = Timestamp.fromDate(input.endDate);
    }

    const unitRef = db.collection("units").doc(lease.unitId);
    const tenantRef = db.collection("tenants").doc(lease.tenantId);
    const unitSnapshot = await tx.get(unitRef);
    const tenantSnapshot = await tx.get(tenantRef);

    if (lease.status === "active") {
      if (!unitSnapshot.exists) {
        throw new ServiceError("not_found", "Unit not found.");
      }
      const unit = unitSnapshot.data() as Unit;
      if (unit.activeLeaseId && unit.activeLeaseId !== leaseId) {
        throw new ServiceError(
          "conflict",
          "This unit is linked to another lease. Refresh and try again.",
        );
      }

      tx.update(unitRef, {
        status: "vacant",
        activeLeaseId: FieldValue.delete(),
        activeTenantId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (
      tenantSnapshot.exists &&
      (tenantSnapshot.data() as Tenant).currentLeaseId === leaseId
    ) {
      tx.update(tenantRef, {
        currentLeaseId: FieldValue.delete(),
        currentUnitId: FieldValue.delete(),
        currentPropertyId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(leaseRef, {
      status: "terminated",
      terminatedAt: FieldValue.serverTimestamp(),
      terminationReason: input.reason,
      endDate,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "lease.terminated",
      entityType: "lease",
      entityId: leaseId,
      before: { status: lease.status, endDate: lease.endDate },
      after: { status: "terminated", endDate },
      reason: input.reason,
    });
  });
}

export async function renewLease(
  actor: SessionUser,
  leaseId: string,
  input: LeaseRenewInput,
): Promise<string> {
  assertCapability(actor, "manage_leases");

  const db = adminDb();
  const sourceRef = db.collection(COLLECTION).doc(leaseId);
  const ref = db.collection(COLLECTION).doc();
  const startDate = Timestamp.fromDate(input.startDate);
  const endDate = Timestamp.fromDate(input.endDate);

  await db.runTransaction(async (tx) => {
    const sourceSnapshot = await tx.get(sourceRef);
    if (!sourceSnapshot.exists) {
      throw new ServiceError("not_found", "Lease not found.");
    }

    const source = sourceSnapshot.data() as Lease;
    assertPropertyAccess(actor, source.propertyId);

    if (source.status !== "active") {
      throw new ServiceError(
        "conflict",
        "Only an active lease can be renewed.",
      );
    }

    if (input.startDate.getTime() < source.startDate.toDate().getTime()) {
      throw new ServiceError(
        "validation",
        "The renewal cannot start before the current lease.",
        { fieldErrors: { startDate: ["Choose a date on or after the current term."] } },
      );
    }

    tx.set(ref, {
      tenantId: source.tenantId,
      unitId: source.unitId,
      propertyId: source.propertyId,
      startDate,
      endDate,
      rentAmountMinor: input.rentAmount,
      currency: source.currency ?? "KES",
      dueDay: input.dueDay,
      depositAmountMinor: source.depositAmountMinor,
      status: "pending",
      renewedFromLeaseId: leaseId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "lease.renewed",
      entityType: "lease",
      entityId: ref.id,
      after: {
        renewedFromLeaseId: leaseId,
        tenantId: source.tenantId,
        unitId: source.unitId,
        propertyId: source.propertyId,
        startDate,
        endDate,
        rentAmountMinor: input.rentAmount,
        dueDay: input.dueDay,
        status: "pending",
      },
      reason: input.reason,
    });
  });

  return ref.id;
}

/**
 * Active leases for a tenant or unit, used by the UI to explain why an action
 * is blocked. Scope is enforced by the caller's property access.
 */
export async function getOpenLeaseForUnit(
  actor: SessionUser,
  unitId: string,
): Promise<LeaseListItem | null> {
  const snapshot = await adminDb()
    .collection(COLLECTION)
    .where("unitId", "==", unitId)
    .where("status", "in", ["pending", "active"])
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const lease = doc.data() as Lease;
  if (!hasGlobalScope(actor)) {
    assertPropertyAccess(actor, lease.propertyId);
  }

  const [item] = await decorate([doc]);
  return item;
}
