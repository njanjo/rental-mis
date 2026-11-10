import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ensureProfileAccount } from "@/lib/auth/account";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { defaultLandingPath } from "@/lib/auth/landing";
import { canAny, type Capability } from "@/lib/auth/permissions";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { Role, UserProfile } from "@/lib/types";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";

export interface SessionUser {
  uid: string;
  /** Account (customer) this session operates in. */
  accountId: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  propertyIds: string[];
  phoneE164?: string;
}

/** Why a request has no usable session. Drives the redirect vs. error page. */
export type SessionFailure =
  | "missing" // no cookie at all
  | "invalid" // cookie rejected / expired / revoked
  | "profile-missing" // Auth user exists but no users/{uid} doc
  | "inactive" // profile deactivated
  | "unassigned-account"; // profile has no account and none can be resolved

export interface SessionResult {
  user: SessionUser | null;
  failure?: SessionFailure;
}

function isEmulator(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/**
 * Resolve the signed-in staff member from the `__session` cookie, including
 * why the session is unusable when it is. `getSessionUser` is the simple
 * boolean form; layouts use this when they need to explain the failure.
 */
export async function resolveSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return { user: null, failure: "missing" };

  let uid: string;
  let tokenEmail: string | undefined;
  let tokenName: string | undefined;

  try {
    // Revocation checks are skipped against the Auth emulator.
    const decoded = await adminAuth().verifySessionCookie(
      sessionCookie,
      !isEmulator(),
    );
    uid = decoded.uid;
    tokenEmail = decoded.email;
    tokenName = decoded.name;
  } catch (error) {
    console.warn(
      "[auth/session] session cookie rejected:",
      error instanceof Error ? error.message : error,
    );
    return { user: null, failure: "invalid" };
  }

  try {
    const snapshot = await adminDb().collection("users").doc(uid).get();
    if (!snapshot.exists) return { user: null, failure: "profile-missing" };

    const profile = snapshot.data() as UserProfile;
    if (!profile.active) return { user: null, failure: "inactive" };

    // A profile without an account is a migration defect, not a valid session.
    // Single-operator deployments resolve it to the default account and repair
    // the profile rather than bouncing the user back to the login page.
    const { accountId } = await ensureProfileAccount(uid, profile.accountId, {
      email: profile.email ?? tokenEmail,
      role: profile.role,
    });
    if (!accountId) {
      console.warn(
        "[auth/session] profile has no accountId and no default account exists:",
        uid,
      );
      return { user: null, failure: "unassigned-account" };
    }

    return {
      user: {
        uid,
        accountId,
        email: profile.email ?? tokenEmail ?? "",
        fullName: profile.fullName ?? tokenName ?? "",
        role: profile.role,
        active: profile.active,
        propertyIds: profile.propertyIds ?? [],
        phoneE164: profile.phoneE164,
      },
    };
  } catch (error) {
    console.warn(
      "[auth/session] profile lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return { user: null, failure: "invalid" };
  }
}

/**
 * Resolve the signed-in staff member from the `__session` cookie.
 * Returns null when the cookie is missing, invalid, revoked, or the
 * user profile is missing/inactive.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  return (await resolveSession()).user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Route-level capability guard. Firestore rules remain the real boundary; this
 * just prevents staff from opening modules their role has no business in.
 */
export async function requireAnyCapability(
  capabilities: Capability[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAny(user.role, capabilities)) {
    redirect(defaultLandingPath(user.role));
  }
  return user;
}
