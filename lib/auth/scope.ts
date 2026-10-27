import "server-only";

import { can, type Capability } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";

/**
 * Property-level authorisation for trusted server code.
 *
 * The Admin SDK bypasses Firestore rules completely, so every query and write
 * must call these helpers. Rules remain the boundary for direct client access;
 * these functions are the boundary for server actions and services.
 */

/** Firestore allows at most 30 values in an `in` query. */
export const IN_QUERY_LIMIT = 30;

export function hasGlobalScope(user: SessionUser): boolean {
  // Admins manage everything. Auditors read everything they are permitted to
  // read; the capability matrix still blocks writes.
  return user.role === "admin" || user.role === "auditor";
}

export function isReadOnly(user: SessionUser): boolean {
  return user.role === "auditor";
}

export function assertCapability(user: SessionUser, capability: Capability): void {
  if (!can(user.role, capability)) {
    throw new ServiceError(
      "forbidden",
      "Your role does not permit this action.",
    );
  }
}

/**
 * Property ids the actor may touch, or `null` for unrestricted access.
 * Throws when a scoped user has no properties — an empty `in` query would
 * otherwise silently return everything.
 */
export function scopePropertyIds(user: SessionUser): string[] | null {
  if (hasGlobalScope(user)) return null;
  if (user.propertyIds.length === 0) {
    throw new ServiceError(
      "forbidden",
      "You are not assigned to any properties. Ask an administrator for access.",
    );
  }
  return [...new Set(user.propertyIds)];
}

export function assertPropertyAccess(
  user: SessionUser,
  propertyId: string,
): void {
  if (!propertyId) {
    throw new ServiceError("validation", "A property is required.");
  }
  if (hasGlobalScope(user)) return;
  if (!user.propertyIds.includes(propertyId)) {
    throw new ServiceError(
      "forbidden",
      "You do not have access to this property.",
    );
  }
}

/** Writes require a capability *and* scope; callers pass the write capability. */
export function assertPropertyWriteAccess(
  user: SessionUser,
  propertyId: string,
  capability: Capability,
): void {
  assertCapability(user, capability);
  if (isReadOnly(user)) {
    throw new ServiceError("forbidden", "This account is read-only.");
  }
  assertPropertyAccess(user, propertyId);
}

/** Split values into Firestore-safe `in` chunks. */
export function chunkIn<T>(values: T[], size = IN_QUERY_LIMIT): T[][] {
  if (size < 1 || size > IN_QUERY_LIMIT) {
    throw new Error(`Invalid 'in' chunk size: ${size}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
