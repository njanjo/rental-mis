import "server-only";

import {
  FieldPath,
  FieldValue,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import {
  assertCapability,
  assertPropertyAccess,
  chunkIn,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Lease, Tenant, Unit, UnitStatus } from "@/lib/types";
import type {
  PageResult,
  UnitLeaseHistoryItem,
  UnitListItem,
  UnitOption,
} from "@/lib/types/views";
import type { UnitInput, UnitUpdateInput } from "@/lib/validation/unit";
import { getPropertyNames } from "@/services/properties";

const COLLECTION = "units";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListUnitsParams {
  q?: string;
  propertyId?: string;
  /** "archived" returns retired units; "all" ignores both status and archive. */
  status?: UnitStatus | "archived" | "all";
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
  params: ListUnitsParams,
): { query: Query; scopeChunked: boolean } {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("unitNumber");
  let scopeChunked = false;

  if (params.propertyId) {
    query = query.where("propertyId", "==", params.propertyId);
  } else if (scope) {
    // Firestore caps `in` at 30 values. Very large scopes fall back to an
    // in-memory filter rather than silently returning every unit.
    if (scope.length <= 30) {
      query = query.where("propertyId", "in", scope);
    } else {
      scopeChunked = true;
    }
  }

  if (params.status === "archived") {
    query = query.where("active", "==", false);
  } else if (params.status === "all") {
    // no archive or status filter
  } else {
    query = query.where("active", "==", true);
    if (params.status) {
      query = query.where("status", "==", params.status);
    }
  }

  return { query, scopeChunked };
}

async function applyCursor(query: Query, cursor?: string): Promise<Query> {
  if (!cursor) return query;
  const snapshot = await adminDb().collection(COLLECTION).doc(cursor).get();
  if (!snapshot.exists) return query;
  return query.startAfter(snapshot);
}

async function tenantDetails(
  ids: string[],
): Promise<Record<string, { name: string; phone: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const result: Record<string, { name: string; phone: string }> = {};

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

async function decorate(docs: QueryDocumentSnapshot[]): Promise<UnitListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as Unit }));
  const [propertyNames, tenants] = await Promise.all([
    getPropertyNames(rows.map((row) => row.data.propertyId)),
    tenantDetails(rows.map((row) => row.data.activeTenantId ?? "")),
  ]);

  return rows.map(({ id, data }) => {
    const tenant = data.activeTenantId ? tenants[data.activeTenantId] : undefined;
    return {
      id,
      propertyId: data.propertyId,
      propertyName: propertyNames[data.propertyId] ?? data.propertyId,
      unitNumber: data.unitNumber,
      rentAmountMinor: data.rentAmountMinor ?? 0,
      depositAmountMinor: data.depositAmountMinor ?? 0,
      currency: data.currency ?? "KES",
      status: data.status,
      active: data.active !== false,
      notes: data.notes,
      archiveReason: data.archiveReason,
      activeLeaseId: data.activeLeaseId,
      activeTenantId: data.activeTenantId,
      tenantName: tenant?.name,
      tenantPhone: tenant?.phone,
      createdAt: toIsoString(data.createdAt) ?? "",
      updatedAt: toIsoString(data.updatedAt) ?? "",
    } satisfies UnitListItem;
  });
}

export async function listUnits(
  actor: SessionUser,
  params: ListUnitsParams = {},
): Promise<PageResult<UnitListItem>> {
  const scope = scopePropertyIds(actor);
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const { query: base, scopeChunked } = buildQuery(scope, params);

  if (q) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeChunked && scope) {
      rows = rows.filter((row) => inScope(scope, row.propertyId));
    }
    rows = rows.filter(
      (row) =>
        row.unitNumber.toLowerCase().includes(q) ||
        row.propertyName.toLowerCase().includes(q) ||
        row.tenantName?.toLowerCase().includes(q),
    );
    return { items: rows, nextCursor: null };
  }

  const query = await applyCursor(base, params.cursor);
  const snapshot = await query.limit(pageSize + 1).get();
  let docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  let items = await decorate(docs);
  if (scopeChunked && scope) {
    items = items.filter((row) => inScope(scope, row.propertyId));
  }

  return {
    items,
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

export async function getUnit(
  actor: SessionUser,
  unitId: string,
): Promise<UnitListItem> {
  const snapshot = await adminDb().collection(COLLECTION).doc(unitId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Unit not found.");
  }

  const data = snapshot.data() as Unit;
  assertPropertyAccess(actor, data.propertyId);

  const [item] = await decorate([snapshot as QueryDocumentSnapshot]);
  return item;
}

/** Recent lease history for the unit detail screen. */
export async function getUnitLeaseHistory(
  actor: SessionUser,
  unitId: string,
  limit = 20,
): Promise<UnitLeaseHistoryItem[]> {
  // getUnit enforces property scope for the unit being inspected.
  await getUnit(actor, unitId);

  const snapshot = await adminDb()
    .collection("leases")
    .where("unitId", "==", unitId)
    .orderBy("startDate", "desc")
    .limit(limit)
    .get();

  if (snapshot.empty) return [];

  const tenants = await tenantDetails(
    snapshot.docs.map((doc) => doc.data().tenantId as string),
  );

  return snapshot.docs.map((doc) => {
    const data = doc.data() as Lease;
    return {
      id: doc.id,
      tenantId: data.tenantId,
      tenantName: tenants[data.tenantId]?.name ?? data.tenantId,
      startDate: toIsoString(data.startDate) ?? "",
      endDate: toIsoString(data.endDate) ?? "",
      rentAmountMinor: data.rentAmountMinor ?? 0,
      status: data.status,
    } satisfies UnitLeaseHistoryItem;
  });
}

export async function getUnitOptions(
  actor: SessionUser,
  options: { propertyId?: string; includeOccupied?: boolean } = {},
): Promise<UnitOption[]> {
  const scope = scopePropertyIds(actor);
  if (options.propertyId) assertPropertyAccess(actor, options.propertyId);

  const { query } = buildQuery(scope, {
    propertyId: options.propertyId,
    status: options.includeOccupied ? undefined : "vacant",
  });
  const snapshot = await query.limit(500).get();
  const units = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Unit }))
    .filter((row) => inScope(scope, row.data.propertyId));

  const propertyNames = await getPropertyNames(
    units.map((row) => row.data.propertyId),
  );

  return units
    .map(({ id, data }) => ({
      id,
      unitNumber: data.unitNumber,
      propertyId: data.propertyId,
      propertyName: propertyNames[data.propertyId] ?? data.propertyId,
      rentAmountMinor: data.rentAmountMinor ?? 0,
      status: data.status,
    }))
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.unitNumber.localeCompare(b.unitNumber),
    );
}

async function assertPropertyActive(propertyId: string): Promise<void> {
  const snapshot = await adminDb().collection("properties").doc(propertyId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Property not found.");
  }
  if (!snapshot.data()?.active) {
    throw new ServiceError(
      "conflict",
      "This property is archived. Restore it before adding units.",
    );
  }
}

export async function createUnit(
  actor: SessionUser,
  input: UnitInput,
): Promise<string> {
  assertCapability(actor, "manage_units");
  assertPropertyAccess(actor, input.propertyId);

  if (input.status === "occupied") {
    throw new ServiceError(
      "validation",
      "Occupancy is set by starting a lease. Create the unit as vacant or under maintenance.",
      { fieldErrors: { status: ["Choose vacant or maintenance."] } },
    );
  }

  await assertPropertyActive(input.propertyId);

  const unitNumber = input.unitNumber.trim().toUpperCase();
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc();

  await db.runTransaction(async (tx) => {
    const duplicate = await tx.get(
      db
        .collection(COLLECTION)
        .where("propertyId", "==", input.propertyId)
        .where("unitNumber", "==", unitNumber)
        .where("active", "==", true)
        .limit(1),
    );
    if (!duplicate.empty) {
      throw new ServiceError(
        "conflict",
        `Unit ${unitNumber} already exists in this property.`,
        { fieldErrors: { unitNumber: ["This unit number is already in use."] } },
      );
    }

    tx.set(ref, {
      propertyId: input.propertyId,
      unitNumber,
      rentAmountMinor: input.rentAmount,
      depositAmountMinor: input.depositAmount,
      currency: "KES",
      status: input.status,
      active: true,
      ...(input.notes ? { notes: input.notes } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unit.created",
      entityType: "unit",
      entityId: ref.id,
      after: {
        propertyId: input.propertyId,
        unitNumber,
        rentAmountMinor: input.rentAmount,
        depositAmountMinor: input.depositAmount,
        status: input.status,
      },
    });
  });

  return ref.id;
}

export async function updateUnit(
  actor: SessionUser,
  unitId: string,
  input: UnitUpdateInput,
): Promise<void> {
  assertCapability(actor, "manage_units");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(unitId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }

    const before = snapshot.data() as Unit;
    assertPropertyAccess(actor, before.propertyId);

    if (before.active === false) {
      throw new ServiceError(
        "conflict",
        "This unit is archived. Restore it before editing.",
      );
    }

    if (input.status === "occupied" && !before.activeLeaseId) {
      throw new ServiceError(
        "validation",
        "Occupancy is set by starting a lease, not by editing the unit.",
        { fieldErrors: { status: ["Start a lease to occupy this unit."] } },
      );
    }

    if (before.activeLeaseId && input.status !== "occupied") {
      throw new ServiceError(
        "conflict",
        "This unit has an active lease. Terminate the lease before changing its status.",
      );
    }

    tx.update(ref, {
      rentAmountMinor: input.rentAmount,
      depositAmountMinor: input.depositAmount,
      status: input.status,
      notes: input.notes ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unit.updated",
      entityType: "unit",
      entityId: unitId,
      before: {
        rentAmountMinor: before.rentAmountMinor,
        depositAmountMinor: before.depositAmountMinor,
        status: before.status,
        notes: before.notes,
      },
      after: {
        rentAmountMinor: input.rentAmount,
        depositAmountMinor: input.depositAmount,
        status: input.status,
        notes: input.notes,
      },
    });
  });
}

export async function archiveUnit(
  actor: SessionUser,
  unitId: string,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_units");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(unitId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }

    const unit = snapshot.data() as Unit;
    assertPropertyAccess(actor, unit.propertyId);

    if (unit.active === false) {
      throw new ServiceError("conflict", "This unit is already archived.");
    }

    const openLeases = await tx.get(
      db
        .collection("leases")
        .where("unitId", "==", unitId)
        .where("status", "in", ["pending", "active"])
        .limit(1),
    );
    if (!openLeases.empty) {
      throw new ServiceError(
        "conflict",
        "Cancel or terminate this unit's leases before archiving it.",
      );
    }

    tx.update(ref, {
      active: false,
      status: "vacant",
      archivedAt: FieldValue.serverTimestamp(),
      archiveReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unit.archived",
      entityType: "unit",
      entityId: unitId,
      before: { active: true, status: unit.status },
      after: { active: false },
      reason,
    });
  });
}

export async function restoreUnit(
  actor: SessionUser,
  unitId: string,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_units");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(unitId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }

    const unit = snapshot.data() as Unit;
    assertPropertyAccess(actor, unit.propertyId);

    if (unit.active !== false) {
      throw new ServiceError("conflict", "This unit is already active.");
    }

    const duplicate = await tx.get(
      db
        .collection(COLLECTION)
        .where("propertyId", "==", unit.propertyId)
        .where("unitNumber", "==", unit.unitNumber)
        .where("active", "==", true)
        .limit(1),
    );
    if (!duplicate.empty) {
      throw new ServiceError(
        "conflict",
        `Unit ${unit.unitNumber} is already active in this property.`,
      );
    }

    tx.update(ref, {
      active: true,
      status: "vacant",
      archivedAt: FieldValue.delete(),
      archiveReason: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "unit.restored",
      entityType: "unit",
      entityId: unitId,
      before: { active: false },
      after: { active: true },
      reason,
    });
  });
}
