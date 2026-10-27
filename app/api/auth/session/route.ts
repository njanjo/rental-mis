import { NextResponse } from "next/server";
import { z } from "zod";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(20),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid idToken is required." }, { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(parsed.data.idToken);

    const snapshot = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!snapshot.exists) {
      return NextResponse.json(
        { error: "This account is not provisioned. Contact an administrator." },
        { status: 403 },
      );
    }

    const profile = snapshot.data() as UserProfile;
    if (!profile.active) {
      return NextResponse.json(
        { error: "This account has been deactivated." },
        { status: 403 },
      );
    }

    const sessionCookie = await adminAuth().createSessionCookie(
      parsed.data.idToken,
      { expiresIn: SESSION_MAX_AGE_SECONDS * 1000 },
    );

    const response = NextResponse.json({
      ok: true,
      role: profile.role,
      fullName: profile.fullName,
    });

    response.cookies.set({
      name: SESSION_COOKIE,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .update({ lastSignInAt: new Date() })
      .catch(() => undefined);

    return response;
  } catch (error) {
    console.error("[auth/session] failed to create session", error);
    return NextResponse.json(
      { error: "Could not start a session. Please sign in again." },
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
