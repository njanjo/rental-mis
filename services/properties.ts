import "server-only";

import {
  FieldPath,
  FieldValue,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import {
  assertCapability,
  assertPropertyAccess,
  scopePropertyIds,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Property, UserProfile } from "@/lib/types";
import type { PageResult, PropertyListItem, PropertyOption } from "@/lib/types/views";
import type { PropertyInput } from "@/lib/validation/property";
import { getStaffNames } from "@/services/staff";

const COLLECTION = "properties";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListPropertiesParams {
  q?: string;
  county?: string;
  status?: "active" | "archived" | "all";
  cursor?: string;
  pageSize?: number;
}

function clampPageSize(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

function include(id: string, scope: string[] | null): boolean {
  return scope === null || scope.includes(id);
}

function buildQuery(
  scope: string[] | null,
  status: "active" | "archived" | "all",
): Query {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("nameLower");

  if (status !== "all") {
    query = query.where("active", "==", status === "active");
  }

  // Firestore caps `in` at 30 values. Larger scopes (rare) are filtered in
  // memory below instead of silently returning everything.
  if (scope && scope.length <= 30) {
    query = query.where(FieldPath.documentId(), "in", scope);
  }

  return query;
}

async function applyCursor(query: Query, cursor?: string): Promise<Query> {
  if (!cursor) return query;
  const snapshot = await adminDb().collection(COLLECTION).doc(cursor).get();
  if (!snapshot.exists) return query;
  return query.startAfter(snapshot);
}

async function unitCounts(propertyIds: string[]): Promise<
  Record<string, { total: number; occupied: number }>
> {
  const counts: Record<string, { total: number; occupied: number }> = {};
  if (propertyIds.length === 0) return counts;

  const db = adminDb();
  const chunks: string[][] = [];
  for (let index = 0; index < propertyIds.length; index += 30) {
    chunks.push(propertyIds.slice(index, index + 30));
  }

  for (const chunk of chunks) {
    const snapshot = await db
      .collection("units")
      .where("propertyId", "in", chunk)
      .where("active", "==", true)
      .get();

    snapshot.docs.forEach((doc) => {
      const propertyId = doc.data().propertyId as string;
      counts[propertyId] ??= { total: 0, occupied: 0 };
      counts[propertyId].total += 1;
      if (doc.data().status === "occupied") counts[propertyId].occupied += 1;
    });
  }

  return counts;
}

function toView(
  doc: QueryDocumentSnapshot,
  counts: Record<string, { total: number; occupied: number }>,
  managerNames: Record<string, string>,
): PropertyListItem {
  const data = doc.data() as Property;
  const managerIds = data.managerIds ?? [];

  return {
    id: doc.id,
    name: data.name,
    address: data.address,
    county: data.county,
    active: data.active !== false,
    unitCount: counts[doc.id]?.total ?? 0,
    occupiedCount: counts[doc.id]?.occupied ?? 0,
    managerIds,
    managerNames: managerIds.map((uid) => managerNames[uid] ?? uid),
    notes: data.notes,
    createdAt: toIsoString(data.createdAt) ?? "",
    updatedAt: toIsoString(data.updatedAt) ?? "",
  };
}

export async function listProperties(
  actor: SessionUser,
  params: ListPropertiesParams = {},
): Promise<PageResult<PropertyListItem>> {
  const scope = scopePropertyIds(actor);
  const status = params.status ?? "active";
  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";

  let query = buildQuery(scope, status);

  if (q) {
    // Text search is applied over a bounded page rather than a full scan.
    const snapshot = await query.limit(SEARCH_LIMIT).get();
    const docs = snapshot.docs.filter((doc) => {
      const data = doc.data() as Property;
      if (!include(doc.id, scope)) return false;
      if (params.county && data.county !== params.county) return false;
      return (
        data.name.toLowerCase().includes(q) ||
        data.address.toLowerCase().includes(q) ||
        data.county.toLowerCase().includes(q)
      );
    });

    return {
      items: await decorate(docs),
      nextCursor: null,
    };
  }

  if (params.county) {
    query = query.where("county", "==", params.county);
  }

  query = await applyCursor(query, params.cursor);
  const snapshot = await query.limit(pageSize + 1).get();
  let docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  if (scope && scope.length > 30) {
    docs = docs.filter((doc) => include(doc.id, scope));
  }

  return {
    items: await decorate(docs),
    nextCursor: hasMore ? docs[docs.length - 1]?.id ?? null : null,
  };
}

async function decorate(docs: QueryDocumentSnapshot[]): Promise<PropertyListItem[]> {
  if (docs.length === 0) return [];

  const counts = await unitCounts(docs.map((doc) => doc.id));
  const managerIds = docs.flatMap((doc) => (doc.data().managerIds as string[]) ?? []);
  const managerNames = await getStaffNames(managerIds);

  return docs.map((doc) => toView(doc, counts, managerNames));
}

export async function getProperty(
  actor: SessionUser,
  propertyId: string,
): Promise<PropertyListItem> {
  assertPropertyAccess(actor, propertyId);

  const snapshot = await adminDb().collection(COLLECTION).doc(propertyId).get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Property not found.");
  }

  const [item] = await decorate([snapshot as unknown as QueryDocumentSnapshot]);
  return item;
}

export async function getPropertyOptions(
  actor: SessionUser,
): Promise<PropertyOption[]> {
  const scope = scopePropertyIds(actor);
  const snapshot = await buildQuery(scope, "active").limit(200).get();

  return snapshot.docs
    .filter((doc) => include(doc.id, scope))
    .map((doc) => ({
      id: doc.id,
      name: doc.data().name as string,
      active: true,
    }));
}

async function assertManagersExist(managerIds: string[]): Promise<string[]> {
  const unique = [...new Set(managerIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const names = await getStaffNames(unique);
  const missing = unique.filter((uid) => !names[uid]);
  if (missing.length > 0) {
    throw new ServiceError("validation", "One or more selected managers do not exist.", {
      fieldErrors: { managerIds: ["Choose valid staff members."] },
    });
  }
  return unique;
}

/**
 * Keep `users.propertyIds` in step with `properties.managerIds`.
 *
 * Scope is read from the staff profile (in the app and in Firestore rules), so
 * assigning a manager without updating their profile would give them a
 * property they cannot see — or leave access behind after they are removed.
 * Admins are global and never carry property ids.
 */
function scopeChange(
  profile: UserProfile | undefined,
  propertyId: string,
  shouldHaveAccess: boolean,
): { propertyIds: string[] } | null {
  if (!profile || profile.role === "admin") return null;

  const current = profile.propertyIds ?? [];
  const hasAccess = current.includes(propertyId);
  if (hasAccess === shouldHaveAccess) return null;

  return {
    propertyIds: shouldHaveAccess
      ? [...current, propertyId]
      : current.filter((id) => id !== propertyId),
  };
}

function profileOf(snapshot: DocumentSnapshot): UserProfile | undefined {
  return snapshot.exists ? (snapshot.data() as UserProfile) : undefined;
}

export async function createProperty(
  actor: SessionUser,
  input: PropertyInput,
): Promise<string> {
  assertCapability(actor, "manage_properties");

  // Only administrators may assign arbitrary managers; a property manager
  // creating a property becomes its manager.
  const managerIds =
    actor.role === "admin"
      ? await assertManagersExist(input.managerIds)
      : [actor.uid];

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc();

  await db.runTransaction(async (tx) => {
    // All reads must happen before the first write.
    const profiles = await Promise.all(
      managerIds.map((uid) => tx.get(db.collection("users").doc(uid))),
    );

    tx.set(ref, {
      name: input.name,
      nameLower: input.name.toLowerCase(),
      address: input.address,
      county: input.county,
      managerIds,
      ...(input.notes ? { notes: input.notes } : {}),
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    profiles.forEach((snapshot) => {
      const change = scopeChange(profileOf(snapshot), ref.id, true);
      if (!change) return;
      tx.update(snapshot.ref, {
        ...change,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "property.created",
      entityType: "property",
      entityId: ref.id,
      after: {
        name: input.name,
        address: input.address,
        county: input.county,
        managerIds,
      },
    });
  });

  return ref.id;
}

export async function updateProperty(
  actor: SessionUser,
  propertyId: string,
  input: PropertyInput,
): Promise<void> {
  assertCapability(actor, "manage_properties");
  assertPropertyAccess(actor, propertyId);

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(propertyId);

  const managerIds =
    actor.role === "admin" ? await assertManagersExist(input.managerIds) : undefined;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Property not found.");
    }

    const before = snapshot.data() as Property;
    const nextManagers = managerIds ?? before.managerIds ?? [];
    const affectedManagers = [
      ...new Set([...(before.managerIds ?? []), ...nextManagers]),
    ].filter(Boolean);

    const managerProfiles = await Promise.all(
      affectedManagers.map((uid) => tx.get(db.collection("users").doc(uid))),
    );

    const update = {
      name: input.name,
      nameLower: input.name.toLowerCase(),
      address: input.address,
      county: input.county,
      notes: input.notes ?? FieldValue.delete(),
      ...(managerIds ? { managerIds } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.update(ref, update);

    managerProfiles.forEach((profileSnapshot, index) => {
      const change = scopeChange(
        profileOf(profileSnapshot),
        propertyId,
        nextManagers.includes(affectedManagers[index]),
      );
      if (!change) return;
      tx.update(profileSnapshot.ref, {
        ...change,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "property.updated",
      entityType: "property",
      entityId: propertyId,
      before: {
        name: before.name,
        address: before.address,
        county: before.county,
        managerIds: before.managerIds,
      },
      after: {
        name: input.name,
        address: input.address,
        county: input.county,
        managerIds: managerIds ?? before.managerIds,
      },
    });
  });
}

export async function archiveProperty(
  actor: SessionUser,
  propertyId: string,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_properties");
  assertPropertyAccess(actor, propertyId);

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(propertyId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Property not found.");
    }

    const property = snapshot.data() as Property;
    if (!property.active) {
      throw new ServiceError("conflict", "This property is already archived.");
    }

    const activeLeases = await tx.get(
      db
        .collection("leases")
        .where("propertyId", "==", propertyId)
        .where("status", "in", ["pending", "active"])
        .limit(1),
    );
    if (!activeLeases.empty) {
      throw new ServiceError(
        "conflict",
        "End or terminate the property's leases before archiving it.",
      );
    }

    tx.update(ref, {
      active: false,
      archivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "property.archived",
      entityType: "property",
      entityId: propertyId,
      before: { active: true },
      after: { active: false },
      reason,
    });
  });
}

export async function restoreProperty(
  actor: SessionUser,
  propertyId: string,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_properties");
  assertPropertyAccess(actor, propertyId);

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(propertyId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Property not found.");
    }
    if (snapshot.data()?.active) {
      throw new ServiceError("conflict", "This property is already active.");
    }

    tx.update(ref, {
      active: true,
      archivedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "property.restored",
      entityType: "property",
      entityId: propertyId,
      before: { active: false },
      after: { active: true },
      reason,
    });
  });
}
