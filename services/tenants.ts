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
  hasGlobalScope,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Tenant, TenantStatus, Unit } from "@/lib/types";
import type {
  PageResult,
  TenantListItem,
  TenantOption,
} from "@/lib/types/views";
import type {
  TenantCreateInput,
  TenantUpdateInput,
} from "@/lib/validation/tenant";
import { getPropertyNames } from "@/services/properties";

const COLLECTION = "tenants";
const PHONE_INDEX = "tenantPhones";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListTenantsParams {
  q?: string;
  propertyId?: string;
  status?: TenantStatus | "all";
  cursor?: string;
  pageSize?: number;
}

function clampPageSize(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

/** Tenants are visible to global roles, their creator, or shared properties. */
export function canAccessTenant(actor: SessionUser, tenant: Tenant): boolean {
  if (hasGlobalScope(actor)) return true;
  if (tenant.createdBy === actor.uid) return true;
  return (tenant.propertyIds ?? []).some((id) => actor.propertyIds.includes(id));
}

export function assertTenantAccess(actor: SessionUser, tenant: Tenant): void {
  if (!canAccessTenant(actor, tenant)) {
    throw new ServiceError("forbidden", "You do not have access to this tenant.");
  }
}

interface TenantQuery {
  query: Query;
  /** True when scope was too large for an `in`-style filter. */
  scopeFallback: string[] | null;
}

function buildQuery(
  scope: string[] | null,
  params: ListTenantsParams,
): TenantQuery {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("fullNameLower");
  let scopeFallback: string[] | null = null;

  if (params.propertyId) {
    query = query.where("propertyIds", "array-contains", params.propertyId);
  } else if (scope) {
    if (scope.length <= 30) {
      query = query.where("propertyIds", "array-contains-any", scope);
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

async function unitNumbers(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const result: Record<string, string> = {};

  for (const chunk of chunkIn(unique)) {
    const snapshot = await db
      .collection("units")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      result[doc.id] = (doc.data() as Unit).unitNumber ?? doc.id;
    });
  }

  return result;
}

async function decorate(docs: QueryDocumentSnapshot[]): Promise<TenantListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({ id: doc.id, data: doc.data() as Tenant }));
  const [propertyNames, units] = await Promise.all([
    getPropertyNames(rows.flatMap((row) => row.data.propertyIds ?? [])),
    unitNumbers(rows.map((row) => row.data.currentUnitId ?? "")),
  ]);

  return rows.map(({ id, data }) => ({
    id,
    fullName: data.fullName,
    phoneE164: data.phoneE164,
    nationalIdLast4: data.nationalIdLast4,
    status: data.status,
    consentSms: data.consentSms !== false,
    notes: data.notes,
    propertyIds: data.propertyIds ?? [],
    propertyNames: (data.propertyIds ?? []).map(
      (propertyId) => propertyNames[propertyId] ?? propertyId,
    ),
    currentLeaseId: data.currentLeaseId,
    currentUnitId: data.currentUnitId,
    currentPropertyId: data.currentPropertyId,
    creditBalanceMinor: data.creditBalanceMinor ?? 0,
    unitNumber: data.currentUnitId ? units[data.currentUnitId] : undefined,
    propertyName: data.currentPropertyId
      ? propertyNames[data.currentPropertyId] ?? data.currentPropertyId
      : undefined,
    createdAt: toIsoString(data.createdAt) ?? "",
    updatedAt: toIsoString(data.updatedAt) ?? "",
  }));
}

export async function listTenants(
  actor: SessionUser,
  params: ListTenantsParams = {},
): Promise<PageResult<TenantListItem>> {
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const scope = scopePropertyIds(actor);
  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const { query: base, scopeFallback } = buildQuery(scope, params);

  if (q) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeFallback) {
      rows = rows.filter((row) =>
        row.propertyIds.some((id) => scopeFallback.includes(id)),
      );
    }
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    rows = rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(q) ||
        (digits.length >= 3 && row.phoneE164.replace(/\D/g, "").includes(digits)),
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
    items = items.filter((row) =>
      row.propertyIds.some((id) => scopeFallback.includes(id)),
    );
  }

  return {
    items,
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

export async function getTenant(
  actor: SessionUser,
  tenantId: string,
): Promise<TenantListItem> {
  const snapshot = await adminDb().collection(COLLECTION).doc(tenantId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Tenant not found.");
  }

  const tenant = snapshot.data() as Tenant;
  assertTenantAccess(actor, tenant);

  const [item] = await decorate([snapshot as QueryDocumentSnapshot]);
  return item;
}

export async function getTenantOptions(
  actor: SessionUser,
  options: { propertyId?: string; excludeTenantId?: string } = {},
): Promise<TenantOption[]> {
  if (options.propertyId) assertPropertyAccess(actor, options.propertyId);

  const scope = scopePropertyIds(actor);
  const db = adminDb();
  let query: Query = db
    .collection(COLLECTION)
    .where("status", "==", "active")
    .orderBy("fullNameLower");

  if (options.propertyId) {
    query = query.where("propertyIds", "array-contains", options.propertyId);
  } else if (scope && scope.length <= 30) {
    query = query.where("propertyIds", "array-contains-any", scope);
  }

  const snapshot = await query.limit(500).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Tenant }))
    .filter(
      ({ id, data }) =>
        id !== options.excludeTenantId &&
        (scope === null ||
          (data.propertyIds ?? []).some((propertyId) => scope.includes(propertyId))),
    )
    .map(({ id, data }) => ({
      id,
      fullName: data.fullName,
      phoneE164: data.phoneE164,
      status: data.status,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function assertPropertyActive(propertyId: string): Promise<void> {
  const snapshot = await adminDb().collection("properties").doc(propertyId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Property not found.");
  }
  if (!snapshot.data()?.active) {
    throw new ServiceError(
      "conflict",
      "This property is archived. Restore it before adding tenants.",
    );
  }
}

export async function createTenant(
  actor: SessionUser,
  input: TenantCreateInput,
): Promise<string> {
  assertCapability(actor, "manage_tenants");
  assertPropertyAccess(actor, input.propertyId);
  await assertPropertyActive(input.propertyId);

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc();
  const phoneRef = db.collection(PHONE_INDEX).doc(input.phone);

  await db.runTransaction(async (tx) => {
    const existingPhone = await tx.get(phoneRef);

    // An inactive index entry may be reused by a returning tenant.
    if (existingPhone.exists && existingPhone.data()?.active === true) {
      throw new ServiceError(
        "conflict",
        "A tenant with this phone number already exists.",
        { fieldErrors: { phone: ["This number is already registered."] } },
      );
    }

    tx.set(ref, {
      fullName: input.fullName,
      fullNameLower: input.fullName.toLowerCase(),
      phoneE164: input.phone,
      ...(input.nationalIdLast4
        ? { nationalIdLast4: input.nationalIdLast4 }
        : {}),
      status: "active",
      consentSms: input.consentSms,
      ...(input.consentSms ? {} : { optedOutAt: FieldValue.serverTimestamp() }),
      propertyIds: [input.propertyId],
      createdBy: actor.uid,
      ...(input.notes ? { notes: input.notes } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(phoneRef, {
      tenantId: ref.id,
      active: true,
      createdAt: existingPhone.exists
        ? existingPhone.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "tenant.created",
      entityType: "tenant",
      entityId: ref.id,
      after: {
        fullName: input.fullName,
        phoneE164: input.phone,
        propertyIds: [input.propertyId],
      },
    });
  });

  return ref.id;
}

export async function updateTenant(
  actor: SessionUser,
  tenantId: string,
  input: TenantUpdateInput,
): Promise<void> {
  assertCapability(actor, "manage_tenants");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(tenantId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Tenant not found.");
    }

    const before = snapshot.data() as Tenant;
    assertTenantAccess(actor, before);

    const phoneChanged = input.phone !== before.phoneE164;
    const oldPhoneRef = db.collection(PHONE_INDEX).doc(before.phoneE164);
    const newPhoneRef = db.collection(PHONE_INDEX).doc(input.phone);

    if (phoneChanged) {
      const existingPhone = await tx.get(newPhoneRef);
      if (
        existingPhone.exists &&
        existingPhone.data()?.active === true &&
        existingPhone.data()?.tenantId !== tenantId
      ) {
        throw new ServiceError(
          "conflict",
          "Another tenant already uses this phone number.",
          { fieldErrors: { phone: ["This number is already registered."] } },
        );
      }

      const oldPhone = await tx.get(oldPhoneRef);
      if (oldPhone.exists && oldPhone.data()?.tenantId === tenantId) {
        tx.update(oldPhoneRef, {
          active: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(newPhoneRef, {
        tenantId,
        active: true,
        createdAt: existingPhone.exists
          ? existingPhone.data()?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(ref, {
      fullName: input.fullName,
      fullNameLower: input.fullName.toLowerCase(),
      phoneE164: input.phone,
      nationalIdLast4: input.nationalIdLast4 ?? FieldValue.delete(),
      consentSms: input.consentSms,
      ...(input.consentSms ? {} : { optedOutAt: FieldValue.serverTimestamp() }),
      ...(input.consentSms ? { optedOutAt: FieldValue.delete() } : {}),
      notes: input.notes ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "tenant.updated",
      entityType: "tenant",
      entityId: tenantId,
      before: {
        fullName: before.fullName,
        phoneE164: before.phoneE164,
        nationalIdLast4: before.nationalIdLast4,
        consentSms: before.consentSms,
        notes: before.notes,
      },
      after: {
        fullName: input.fullName,
        phoneE164: input.phone,
        nationalIdLast4: input.nationalIdLast4,
        consentSms: input.consentSms,
        notes: input.notes,
      },
    });
  });
}

export async function setTenantStatus(
  actor: SessionUser,
  tenantId: string,
  status: TenantStatus,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_tenants");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(tenantId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Tenant not found.");
    }

    const tenant = snapshot.data() as Tenant;
    assertTenantAccess(actor, tenant);

    if (tenant.status === status) {
      throw new ServiceError("conflict", `This tenant is already ${status}.`);
    }

    if (tenant.currentLeaseId && status !== "active") {
      throw new ServiceError(
        "conflict",
        "End or terminate the active lease before changing this tenant's status.",
      );
    }

    tx.update(ref, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "tenant.status_changed",
      entityType: "tenant",
      entityId: tenantId,
      before: { status: tenant.status },
      after: { status },
      reason,
    });
  });
}
