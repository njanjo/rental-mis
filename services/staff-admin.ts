import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/audit";
import { assertCapability, requireAccount } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { normaliseKenyanPhone } from "@/lib/phone";
import type { Property, UserProfile } from "@/lib/types";
import type { StaffListItem } from "@/lib/types/views";
import type {
  StaffInviteInput,
  StaffRoleScopeInput,
} from "@/lib/validation/settings";
import { getPropertyNames } from "@/services/properties";

/**
 * Staff administration (down the same chain the CLI runbook uses,
 * `scripts/provision-staff.ts`):
 *
 *     Auth user -> { role } custom claim -> users/{uid} doc -> audit entry
 *
 * All of it lives in trusted server code with `manage_staff` gates. Rules deny
 * every client write to `users`; the Admin SDK bypasses rules, so capability,
 * account and guardrail checks happen here.
 */

const USERS = "users";
const PROPERTIES = "properties";
const STAFF_LIMIT = 500;

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*";
const PASSWORD_LENGTH = 18;

/** Strong single-use password shown to the inviting admin exactly once. */
export function generateStaffPassword(length = PASSWORD_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let password = "";
  for (const byte of bytes) {
    password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  }
  return password;
}

function profileOf(snapshot: { exists: boolean; data(): unknown }): UserProfile | null {
  return snapshot.exists ? ((snapshot.data() as UserProfile) ?? null) : null;
}

/** Read one staff profile, refusing anything outside the actor's account. */
async function accountProfile(
  actor: SessionUser,
  uid: string,
): Promise<UserProfile> {
  const snapshot = await adminDb().collection(USERS).doc(uid).get();
  const profile = profileOf(snapshot);
  if (!profile || !profile.accountId || profile.accountId !== actor.accountId) {
    throw new ServiceError("not_found", "No staff profile exists for that account.");
  }
  return profile;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listStaff(actor: SessionUser): Promise<StaffListItem[]> {
  assertCapability(actor, "manage_staff");
  const accountId = requireAccount(actor);

  const snapshot = await adminDb()
    .collection(USERS)
    .where("accountId", "==", accountId)
    .orderBy("fullName")
    .limit(STAFF_LIMIT)
    .get();

  const profiles = snapshot.docs.map(
    (doc) => ({ id: doc.id, data: doc.data() as UserProfile }),
  );
  if (profiles.length === 0) return [];

  const propertyNames = await getPropertyNames(
    accountId,
    profiles.flatMap((profile) => profile.data.propertyIds ?? []),
  );

  return profiles.map((profile) => ({
    uid: profile.id,
    fullName: profile.data.fullName ?? profile.id,
    email: profile.data.email ?? "",
    role: profile.data.role,
    phoneE164: profile.data.phoneE164,
    active: profile.data.active === true,
    propertyIds: profile.data.propertyIds ?? [],
    propertyNames: (profile.data.propertyIds ?? [])
      .map((id) => propertyNames[id] ?? id)
      .filter(Boolean),
    lastSignInAt: toIsoString(profile.data.lastSignInAt) ?? undefined,
    createdAt: toIsoString(profile.data.createdAt) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Property validation and manager sync
// ---------------------------------------------------------------------------

async function validatePropertyScope(
  accountId: string,
  propertyIds: string[],
): Promise<{ valid: Set<string>; error: ServiceError | null }> {
  const unique = [...new Set(propertyIds.filter(Boolean))];
  if (unique.length === 0) return { valid: new Set(), error: null };

  const properties = await adminDb()
    .collection(PROPERTIES)
    .where("accountId", "==", accountId)
    .get();
  const known = new Map(
    properties.docs.map((doc) => [
      doc.id,
      (doc.data() as Property).active !== false,
    ]),
  );

  const missing = unique.filter((id) => !known.has(id));
  const archived = unique.filter((id) => known.has(id) && !known.get(id));
  if (missing.length > 0) {
    return {
      valid: new Set(),
      error: new ServiceError(
        "validation",
        "One or more selected properties do not exist.",
        { fieldErrors: { propertyIds: ["Choose properties in your account."] } },
      ),
    };
  }
  if (archived.length > 0) {
    return {
      valid: new Set(),
      error: new ServiceError(
        "validation",
        "Archived properties cannot be assigned.",
        { fieldErrors: { propertyIds: ["Pick active properties only."] } },
      ),
    };
  }
  return { valid: new Set(unique), error: null };
}

/**
 * Keep `properties.managerIds` in step with profile scope, per docs/DECISIONS.md
 * ("Assigning or removing a manager on a property updates that profile in the
 * same transaction, so access can never drift").
 *
 * Membership for `uid` is reconciled across the given properties.
 */
function syncManagerMemberships(
  tx: Transaction,
  uid: string,
  properties: { id: string; managerIds: string[] }[],
  memberProperties: Set<string>,
): void {
  for (const property of properties) {
    const current = property.managerIds ?? [];
    const shouldHave = memberProperties.has(property.id);
    const has = current.includes(uid);
    if (shouldHave === has) continue;

    tx.update(adminDb().collection(PROPERTIES).doc(property.id), {
      managerIds: shouldHave
        ? [...current, uid]
        : current.filter((id) => id !== uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Properties of the account where `uid` currently appears in `managerIds`. */
async function managerMemberships(
  accountId: string,
  uid: string,
): Promise<{ id: string; managerIds: string[] }[]> {
  const snapshot = await adminDb()
    .collection(PROPERTIES)
    .where("accountId", "==", accountId)
    .get();
  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      managerIds: ((doc.data() as Property).managerIds ?? []).slice(),
    }))
    .filter((property) => property.managerIds.includes(uid));
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export interface InviteResult {
  uid: string;
  /** Generated password — surfaced ONCE to the inviting admin, then gone. */
  password: string;
  adopted: boolean;
}

export async function inviteStaff(
  actor: SessionUser,
  input: StaffInviteInput,
): Promise<InviteResult> {
  assertCapability(actor, "manage_staff");
  const accountId = requireAccount(actor);

  if (input.role === "admin" && input.propertyIds.length > 0) {
    // Admins are global by design (docs/DECISIONS.md, Phase 3 decisions).
    input.propertyIds = [];
  }

  const propertyScope =
    await validatePropertyScope(accountId, input.propertyIds);
  if (propertyScope.error) throw propertyScope.error;

  let phoneE164: string | undefined;
  if (input.phoneE164) {
    const normalised = normaliseKenyanPhone(input.phoneE164);
    if (!normalised) {
      throw new ServiceError("validation", "Enter a valid Kenyan mobile number.", {
        fieldErrors: { phoneE164: ["Use a Kenyan number, e.g. 0712 345 678."] },
      });
    }
    phoneE164 = normalised;
  }

  const auth = adminAuth();
  const db = adminDb();

  // Upsert the Auth user. An existing auth user may be adopted when it has no
  // usable profile in this account yet (mirrors the CLI upsert pattern).
  const existing = await auth.getUserByEmail(input.email).catch(() => null);
  let uid: string;
  const adopted = Boolean(existing);
  const password = generateStaffPassword();

  if (existing) {
    const profileSnapshot = await db.collection(USERS).doc(existing.uid).get();
    const existingProfile = profileOf(profileSnapshot);
    if (existingProfile) {
      throw new ServiceError(
        "conflict",
        existingProfile.accountId === accountId
          ? "This person is already provisioned in the staff list."
          : "That email is already in use by another account.",
      );
    }
    uid = existing.uid;
    await auth.updateUser(uid, {
      displayName: input.fullName,
      emailVerified: true,
      disabled: false,
      password,
    });
  } else {
    const created = await auth.createUser({
      email: input.email,
      password,
      displayName: input.fullName,
      emailVerified: true,
    });
    uid = created.uid;
  }

  await auth.setCustomUserClaims(uid, { role: input.role });

  await db.runTransaction(async (tx) => {
    // Re-read inside the transaction: a concurrent invite could have created
    // the profile between the Auth check and this transaction.
    const profileSnapshot = await tx.get(db.collection(USERS).doc(uid));
    if (profileSnapshot.exists) {
      throw new ServiceError(
        "conflict",
        "This email was provisioned by someone else moments ago.",
      );
    }

    tx.set(db.collection(USERS).doc(uid), {
      uid,
      accountId,
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      propertyIds: input.role === "admin" ? [] : [...propertyScope.valid],
      ...(phoneE164 ? { phoneE164 } : {}),
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      accountId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "staff.invited",
      entityType: "staff",
      entityId: uid,
      after: {
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        propertyIds: input.role === "admin" ? [] : [...propertyScope.valid],
        adopted,
      },
    });
  });

  return { uid, password, adopted };
}

// ---------------------------------------------------------------------------
// Role + property scope
// ---------------------------------------------------------------------------

type ScopeChange = {
  roleChanged: boolean;
  scopeChanged: boolean;
};

export async function updateStaffRoleScope(
  actor: SessionUser,
  uid: string,
  input: StaffRoleScopeInput,
): Promise<ScopeChange> {
  assertCapability(actor, "manage_staff");
  const accountId = requireAccount(actor);

  if (uid === actor.uid) {
    throw new ServiceError(
      "forbidden",
      "You cannot change your own role or scope. Ask another administrator.",
    );
  }
  if (input.role === "admin" && input.propertyIds.length > 0) {
    input.propertyIds = [];
  }

  const propertyScope =
    await validatePropertyScope(accountId, input.propertyIds);
  if (propertyScope.error) throw propertyScope.error;

  const db = adminDb();
  const targetRef = db.collection(USERS).doc(uid);

  let roleChanged = false;
  let scopeChanged = false;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(targetRef);
    if (!snapshot.exists) {
      throw new ServiceError("not_found", "Staff member not found.");
    }
    const profile = snapshot.data() as UserProfile;
    if (profile.accountId !== accountId) {
      throw new ServiceError("not_found", "Staff member not found.");
    }
    if (!profile.active) {
      throw new ServiceError(
        "conflict",
        "Reactivate this staff member before changing their access.",
      );
    }

    roleChanged = profile.role !== input.role;
    const nextScope = input.role === "admin" ? [] : [...propertyScope.valid];
    scopeChanged =
      nextScope.length !== (profile.propertyIds ?? []).length ||
      nextScope.some((id) => !(profile.propertyIds ?? []).includes(id));

    if (!roleChanged && !scopeChanged) return;

    // Reconcile membership where this person is or becomes a named manager.
    const nextMemberProperties = new Set<string>(
      input.role === "property_manager" ? nextScope : [],
    );
    const affected = new Map(
      (await managerMemberships(accountId, uid)).map((property) => [
        property.id,
        property,
      ]),
    );
    for (const id of nextMemberProperties) {
      if (!affected.has(id)) {
        affected.set(id, { id, managerIds: [] });
      }
    }

    tx.update(targetRef, {
      role: input.role,
      propertyIds: nextScope,
      updatedAt: FieldValue.serverTimestamp(),
    });

    syncManagerMemberships(tx, uid, [...affected.values()], nextMemberProperties);

    writeAuditLog(tx, {
      accountId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: roleChanged ? "staff.role_updated" : "staff.scope_updated",
      entityType: "staff",
      entityId: uid,
      before: { role: profile.role, propertyIds: profile.propertyIds ?? [] },
      after: { role: input.role, propertyIds: nextScope },
    });
  });

  if (roleChanged) {
    // Claims only matter at session mint; profile role is the rules boundary.
    await adminAuth()
      .setCustomUserClaims(uid, { role: input.role })
      .catch((error: unknown) => {
        console.warn("[settings/staff] custom claim update failed:", error);
      });
  }

  return { roleChanged, scopeChanged };
}

// ---------------------------------------------------------------------------
// Deactivate / reactivate
// ---------------------------------------------------------------------------

async function activeAdminCount(
  tx: Transaction,
  accountId: string,
  excludingUid?: string,
): Promise<number> {
  const snapshot = await tx.get(
    adminDb()
      .collection(USERS)
      .where("accountId", "==", accountId)
      .where("role", "==", "admin"),
  );
  return snapshot.docs.filter(
    (doc) =>
      doc.id !== excludingUid && (doc.data() as UserProfile).active === true,
  ).length;
}

export async function setStaffActive(
  actor: SessionUser,
  uid: string,
  active: boolean,
  reason: string,
): Promise<void> {
  assertCapability(actor, "manage_staff");
  const accountId = requireAccount(actor);

  if (uid === actor.uid) {
    throw new ServiceError(
      "forbidden",
      active
        ? "Your own account is already active."
        : "You cannot deactivate your own account.",
    );
  }

  const db = adminDb();
  const targetRef = db.collection(USERS).doc(uid);
  const profile = await accountProfile(actor, uid);

  if (profile.active === active) {
    throw new ServiceError(
      "conflict",
      active ? "This staff member is already active." : "This staff member is already deactivated.",
    );
  }

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(targetRef);
    const current = profileOf(snapshot);
    if (!current || current.accountId !== accountId) {
      throw new ServiceError("not_found", "Staff member not found.");
    }

    // The account must always retain one active administrator.
    if (current.role === "admin" && !active) {
      const remaining = await activeAdminCount(tx, accountId, uid);
      if (remaining === 0) {
        throw new ServiceError(
          "conflict",
          "Promote another administrator before deactivating the last one.",
        );
      }
    }

    tx.update(targetRef, {
      active,
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      accountId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action: active ? "staff.reactivated" : "staff.deactivated",
      entityType: "staff",
      entityId: uid,
      before: { active: current.active ?? true },
      after: { active },
      reason,
    });
  });

  // Belt and braces: profile.active already gates every session and rule
  // lookup; disabling the Auth user also locks any stale refresh path.
  await adminAuth()
    .updateUser(uid, { disabled: !active })
    .catch((error: unknown) => {
      console.warn("[settings/staff] auth account toggle failed:", error);
    });
}
