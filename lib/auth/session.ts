import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE } from "@/lib/auth/constants";
import { defaultLandingPath } from "@/lib/auth/landing";
import { canAny, type Capability } from "@/lib/auth/permissions";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { Role, UserProfile } from "@/lib/types";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";

export interface SessionUser {
  uid: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  propertyIds: string[];
}

function isEmulator(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/**
 * Resolve the signed-in staff member from the `__session` cookie.
 * Returns null when the cookie is missing, invalid, revoked, or the
 * user profile is missing/inactive.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;

  try {
    // Revocation checks are skipped against the Auth emulator.
    const decoded = await adminAuth().verifySessionCookie(
      sessionCookie,
      !isEmulator(),
    );

    const snapshot = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!snapshot.exists) return null;

    const profile = snapshot.data() as UserProfile;
    if (!profile.active) return null;

    return {
      uid: decoded.uid,
      email: profile.email ?? decoded.email ?? "",
      fullName: profile.fullName ?? decoded.name ?? "",
      role: profile.role,
      active: profile.active,
      propertyIds: profile.propertyIds ?? [],
    };
  } catch (error) {
    console.warn(
      "[auth/session] session cookie rejected:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
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
