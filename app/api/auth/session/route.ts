/**
 * Session endpoints.
 *
 * POST — mints the `__session` cookie from a Firebase ID token obtained by a
 * successful email + password sign-in. The token is verified with the Admin
 * SDK and checked against the users profile (exists + active) before a cookie
 * is issued; unauthenticated or deactivated accounts never get a session.
 *
 * DELETE — sign-out: clears the session cookie.
 */
import { NextResponse } from "next/server";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let idToken: string | undefined;

  try {
    const body = (await request.json()) as { idToken?: string };
    idToken = typeof body?.idToken === "string" ? body.idToken : undefined;
  } catch {
    idToken = undefined;
  }

  if (!idToken) {
    return NextResponse.json({ error: "Missing ID token." }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(idToken, true);

    // Only active staff profiles get a session; the Auth account alone is not
    // enough (custom claims mirror the profile but the profile is authoritative).
    const snapshot = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!snapshot.exists) {
      return NextResponse.json(
        { error: "This account is not provisioned for this system." },
        { status: 403 },
      );
    }

    const profile = snapshot.data();
    if (!profile?.active) {
      return NextResponse.json(
        { error: "This account has been deactivated." },
        { status: 403 },
      );
    }

    const sessionCookie = await adminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.warn(
      "[auth/session] session mint rejected:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Could not start a session. Sign in again." },
      { status: 401 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
