import "server-only";

import {
  FieldPath,
  FieldValue,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
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
import type {
  MaintenancePriority,
  MaintenanceRequest,
  MaintenanceStatus,
  Property,
  Role,
  Unit,
} from "@/lib/types";
import type {
  MaintenanceListItem,
  PageResult,
} from "@/lib/types/views";
import {
  canTransitionMaintenance,
  type MaintenanceCreateInput,
  type MaintenanceUpdateInput,
} from "@/lib/validation/maintenance";
import { getPropertyNames } from "@/services/properties";
import { getStaffNames } from "@/services/staff";

const COLLECTION = "maintenanceRequests";
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 200;

export interface ListMaintenanceParams {
  q?: string;
  propertyId?: string;
  status?: MaintenanceStatus | "all";
  priority?: MaintenancePriority | "all";
  assignedTo?: string;
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
  params: ListMaintenanceParams,
): { query: Query; scopeFallback: string[] | null } {
  const db = adminDb();
  let query: Query = db.collection(COLLECTION).orderBy("createdAt", "desc");
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
  docs: QueryDocumentSnapshot[],
): Promise<MaintenanceListItem[]> {
  if (docs.length === 0) return [];

  const rows = docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as MaintenanceRequest,
  }));

  const [propertyNames, units, staffNames] = await Promise.all([
    getPropertyNames(rows.map((row) => row.data.propertyId)),
    unitsById(rows.map((row) => row.data.unitId)),
    getStaffNames(
      rows.flatMap((row) => [row.data.createdBy, row.data.assignedTo ?? ""]),
    ),
  ]);

  return rows.map(({ id, data }) => ({
    id,
    propertyId: data.propertyId,
    propertyName: propertyNames[data.propertyId] ?? data.propertyId,
    unitId: data.unitId,
    unitNumber: units[data.unitId]?.unitNumber ?? data.unitId,
    title: data.title,
    issue: data.issue,
    priority: data.priority,
    status: data.status,
    assignedTo: data.assignedTo,
    assignedToName: data.assignedTo
      ? staffNames[data.assignedTo] ?? data.assignedToName ?? data.assignedTo
      : undefined,
    createdBy: data.createdBy,
    createdByName: staffNames[data.createdBy] ?? data.createdBy,
    notes: data.notes,
    resolutionNote: data.resolutionNote,
    createdAt: toIsoString(data.createdAt) ?? "",
    updatedAt: toIsoString(data.updatedAt) ?? "",
    resolvedAt: toIsoString(data.resolvedAt),
    closedAt: toIsoString(data.closedAt),
  }));
}

export async function listMaintenance(
  actor: SessionUser,
  params: ListMaintenanceParams = {},
): Promise<PageResult<MaintenanceListItem>> {
  assertCapability(actor, "update_maintenance");

  const scope = scopePropertyIds(actor);
  if (params.propertyId) assertPropertyAccess(actor, params.propertyId);

  const pageSize = clampPageSize(params.pageSize);
  const q = params.q?.trim().toLowerCase() ?? "";
  const priority =
    params.priority && params.priority !== "all" ? params.priority : undefined;
  const assignedTo = params.assignedTo?.trim() || undefined;
  const inMemory = Boolean(q || priority || assignedTo);

  const { query: base, scopeFallback } = buildQuery(scope, params);

  if (inMemory) {
    const snapshot = await base.limit(SEARCH_LIMIT).get();
    let rows = await decorate(snapshot.docs);
    if (scopeFallback) {
      rows = rows.filter((row) => inScope(scopeFallback, row.propertyId));
    }
    if (priority) rows = rows.filter((row) => row.priority === priority);
    if (assignedTo) {
      rows = rows.filter((row) => row.assignedTo === assignedTo);
    }
    if (q) {
      rows = rows.filter(
        (row) =>
          row.title.toLowerCase().includes(q) ||
          row.issue.toLowerCase().includes(q) ||
          row.unitNumber.toLowerCase().includes(q) ||
          row.propertyName.toLowerCase().includes(q) ||
          (row.assignedToName ?? "").toLowerCase().includes(q),
      );
    }
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

export async function getMaintenance(
  actor: SessionUser,
  requestId: string,
): Promise<MaintenanceListItem> {
  assertCapability(actor, "update_maintenance");

  const snapshot = await adminDb()
    .collection(COLLECTION)
    .doc(requestId)
    .get();
  if (!snapshot.exists) {
    throw new ServiceError("not_found", "Maintenance request not found.");
  }

  const request = snapshot.data() as MaintenanceRequest;
  assertPropertyAccess(actor, request.propertyId);

  const [item] = await decorate([snapshot as QueryDocumentSnapshot]);
  return item;
}

/**
 * Assignment targets must be active staff who can progress maintenance work
 * and who can see the request's property. Admins are global.
 */
async function readAssignee(
  tx: Transaction,
  propertyId: string,
  uid: string,
): Promise<{ uid: string; name: string }> {
  const snapshot = await tx.get(adminDb().collection("users").doc(uid));
  if (!snapshot.exists) {
    throw new ServiceError("validation", "The selected assignee no longer exists.", {
      fieldErrors: { assignedTo: ["Choose an active staff member."] },
    });
  }

  const data = snapshot.data() as {
    fullName?: string;
    role?: string;
    propertyIds?: string[];
    active?: boolean;
  };

  if (
    !data.active ||
    !data.role ||
    !can(data.role as Role, "update_maintenance")
  ) {
    throw new ServiceError(
      "validation",
      "Only active property or maintenance staff can be assigned.",
      { fieldErrors: { assignedTo: ["Choose an active staff member."] } },
    );
  }

  if (data.role !== "admin" && !(data.propertyIds ?? []).includes(propertyId)) {
    throw new ServiceError(
      "validation",
      "That staff member is not assigned to this property.",
      { fieldErrors: { assignedTo: ["Choose someone with access to this property."] } },
    );
  }

  return { uid, name: data.fullName ?? uid };
}

export async function createMaintenance(
  actor: SessionUser,
  input: MaintenanceCreateInput,
): Promise<string> {
  assertCapability(actor, "manage_maintenance");
  assertPropertyAccess(actor, input.propertyId);

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc();
  const propertyRef = db.collection("properties").doc(input.propertyId);
  const unitRef = db.collection("units").doc(input.unitId);

  await db.runTransaction(async (tx) => {
    const propertySnapshot = await tx.get(propertyRef);
    if (!propertySnapshot.exists) {
      throw new ServiceError("not_found", "Property not found.");
    }
    if (!(propertySnapshot.data() as Property).active) {
      throw new ServiceError(
        "conflict",
        "This property is archived. Restore it before logging maintenance.",
      );
    }

    const unitSnapshot = await tx.get(unitRef);
    if (!unitSnapshot.exists) {
      throw new ServiceError("not_found", "Unit not found.");
    }
    const unit = unitSnapshot.data() as Unit;
    if (unit.propertyId !== input.propertyId) {
      throw new ServiceError(
        "validation",
        "That unit does not belong to the selected property.",
        { fieldErrors: { unitId: ["Choose a unit in this property."] } },
      );
    }
    if (unit.active === false) {
      throw new ServiceError(
        "conflict",
        "This unit is archived. Restore it before logging maintenance.",
      );
    }

    const assignee = input.assignedTo
      ? await readAssignee(tx, input.propertyId, input.assignedTo)
      : null;

    // Assigning at creation is the same as assigning right afterwards.
    const status: MaintenanceStatus = assignee ? "assigned" : "open";

    tx.set(ref, {
      propertyId: input.propertyId,
      unitId: input.unitId,
      title: input.title,
      issue: input.issue,
      priority: input.priority,
      status,
      ...(assignee
        ? { assignedTo: assignee.uid, assignedToName: assignee.name }
        : {}),
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "maintenance.created",
      entityType: "maintenance",
      entityId: ref.id,
      after: {
        propertyId: input.propertyId,
        unitId: input.unitId,
        title: input.title,
        priority: input.priority,
        status,
        assignedTo: assignee?.uid ?? null,
      },
    });
  });

  return ref.id;
}

export async function updateMaintenance(
  actor: SessionUser,
  requestId: string,
  input: MaintenanceUpdateInput,
): Promise<void> {
  assertCapability(actor, "update_maintenance");

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(requestId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Maintenance request not found.");
    }

    const request = snapshot.data() as MaintenanceRequest;
    assertPropertyAccess(actor, request.propertyId);

    if (request.status === "resolved" || request.status === "cancelled") {
      throw new ServiceError(
        "conflict",
        `This request is already ${request.status} and can no longer change.`,
      );
    }

    const nextPriority = input.priority;
    let nextStatus: MaintenanceStatus = input.status;
    const assigneeChanged = input.assignedTo !== request.assignedTo;

    if (
      nextStatus !== request.status &&
      !canTransitionMaintenance(request.status, nextStatus)
    ) {
      throw new ServiceError(
        "conflict",
        `A ${request.status.replace("_", " ")} request cannot move to ${nextStatus.replace("_", " ")}.`,
      );
    }

    if (assigneeChanged && !can(actor.role, "manage_maintenance")) {
      throw new ServiceError(
        "forbidden",
        "Only property managers and administrators can reassign maintenance work.",
      );
    }

    let assignee: { uid: string; name: string } | null = null;
    if (input.assignedTo) {
      assignee = assigneeChanged
        ? await readAssignee(tx, request.propertyId, input.assignedTo)
        : {
            uid: input.assignedTo,
            name: request.assignedToName ?? input.assignedTo,
          };
    }

    // Setting an owner on an open request is an implicit assignment.
    if (request.status === "open" && nextStatus === "open" && assignee) {
      nextStatus = "assigned";
    }

    if (
      (nextStatus === "assigned" || nextStatus === "in_progress") &&
      !assignee
    ) {
      throw new ServiceError(
        "validation",
        "Assign this request before it can be worked on.",
        { fieldErrors: { assignedTo: ["Choose who is doing the work."] } },
      );
    }

    if (
      (nextStatus === "resolved" || nextStatus === "cancelled") &&
      !input.note
    ) {
      throw new ServiceError(
        "validation",
        nextStatus === "resolved"
          ? "Describe what was done before resolving the request."
          : "Give a reason before cancelling the request.",
        { fieldErrors: { note: ["A short note is required."] } },
      );
    }

    const updates: Record<string, unknown> = {
      status: nextStatus,
      priority: nextPriority,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (input.note) updates.notes = input.note;

    if (assignee) {
      updates.assignedTo = assignee.uid;
      updates.assignedToName = assignee.name;
    } else {
      updates.assignedTo = FieldValue.delete();
      updates.assignedToName = FieldValue.delete();
    }

    if (nextStatus === "resolved") {
      updates.resolvedAt = FieldValue.serverTimestamp();
      updates.resolutionNote = input.note;
    }
    if (nextStatus === "cancelled") {
      updates.closedAt = FieldValue.serverTimestamp();
      updates.resolutionNote = input.note;
    }

    tx.update(ref, updates);

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "maintenance.updated",
      entityType: "maintenance",
      entityId: requestId,
      before: {
        status: request.status,
        priority: request.priority,
        assignedTo: request.assignedTo ?? null,
      },
      after: {
        status: nextStatus,
        priority: nextPriority,
        assignedTo: assignee?.uid ?? null,
      },
      reason: input.note,
    });
  });
}
