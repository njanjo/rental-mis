import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";

export interface AuditEntry {
  actorUid: string;
  actorRole: Role;
  /** Verb in past tense, e.g. "property.created" or "lease.terminated". */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
}

/** Firestore rejects `undefined` values; drop them recursively. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const prototype = Object.getPrototypeOf(value);
    // Leave Timestamps, FieldValues and other class instances untouched.
    if (prototype !== Object.prototype && prototype !== null) return value;

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = clean(entry);
    }
    return result;
  }
  return value;
}

/**
 * Append an audit record inside the caller's transaction so the log can never
 * drift from the change it describes.
 */
export function writeAuditLog(tx: Transaction, entry: AuditEntry): void {
  const ref = adminDb().collection("auditLogs").doc();

  // Firestore rejects `undefined` at any depth, including top-level fields.
  const payload: Record<string, unknown> = {
    actorUid: entry.actorUid,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    createdAt: FieldValue.serverTimestamp(),
  };
  if (entry.before) payload.before = clean(entry.before);
  if (entry.after) payload.after = clean(entry.after);
  if (entry.reason) payload.reason = entry.reason;

  tx.set(ref, payload);
}
