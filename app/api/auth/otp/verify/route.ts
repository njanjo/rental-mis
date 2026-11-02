/**
 * OTP verify — check the code, mark the challenge consumed, and mint a session.
 *
 * This is the only route that creates a `__session` cookie. The password has
 * already been confirmed by `POST /api/auth/otp/request`, so this route only
 * needs to validate the challenge and the code.
 *
 * The Firebase Admin calls (`createCustomToken`, `createSessionCookie`) are
 * made outside the transaction — they are not Firestore operations and must
 * not run inside a transaction callback. The transaction only touches the
 * challenge document, the user profile, and the audit log.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";
import { writeAuditLog } from "@/lib/audit";
import { isValidOtpFormat, verifyOtp } from "@/lib/otp";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(1),
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
    return NextResponse.json(
      { error: "A challenge id and code are required." },
      { status: 400 },
    );
  }

  const code = parsed.data.code.trim();
  if (!isValidOtpFormat(code)) {
    return NextResponse.json(
      { error: "Enter the 6-digit code sent to your phone." },
      { status: 400 },
    );
  }

  const challengeRef = adminDb()
    .collection("otpChallenges")
    .doc(parsed.data.challengeId);

  const now = new Date();

  // 1. Read the challenge outside a transaction so we can fail fast.
  const challengeSnap = await challengeRef.get();
  if (!challengeSnap.exists) {
    return NextResponse.json(
      { error: "That challenge has expired. Request a new code." },
      { status: 404 },
    );
  }

  const challenge = challengeSnap.data() as {
    uid: string;
    phoneE164: string;
    codeHash: string;
    attempts: number;
    maxAttempts: number;
    expiresAt: { toDate: () => Date };
    consumedAt?: { toDate: () => Date };
  };

  if (challenge.consumedAt) {
    return NextResponse.json(
      { error: "That code has already been used." },
      { status: 409 },
    );
  }

  const expiresAt = challenge.expiresAt?.toDate?.() ?? new Date(0);
  if (expiresAt.getTime() < now.getTime()) {
    return NextResponse.json(
      { error: "That code has expired. Request a new one." },
      { status: 410 },
    );
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    await challengeRef.delete();
    return NextResponse.json(
      { error: "Too many incorrect attempts. Request a new code." },
      { status: 429 },
    );
  }

  if (!verifyOtp(code, challenge.codeHash)) {
    await challengeRef.update({
      attempts: (challenge.attempts ?? 0) + 1,
      updatedAt: new Date(),
    });
    return NextResponse.json(
      { error: "Incorrect code. Try again." },
      { status: 401 },
    );
  }

  // 2. Code is correct — read the user profile.
  const userRef = adminDb().collection("users").doc(challenge.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const profile = userSnap.data() as UserProfile;
  if (!profile.active) {
    return NextResponse.json(
      { error: "This account has been deactivated." },
      { status: 403 },
    );
  }

  // 3. Mint the session cookie (Admin SDK — not a Firestore operation).
  const idToken = await adminAuth().createCustomToken(challenge.uid, {
    email: profile.email,
    role: profile.role,
  });
  const sessionCookie = await adminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
  });

  // 4. Consume the challenge, update the profile, and write the audit log.
  await adminDb().runTransaction(async (tx) => {
    // Re-check inside the transaction so a concurrent verify can't double-consume.
    const fresh = await tx.get(challengeRef);
    if (fresh.exists && !fresh.data()?.consumedAt) {
      tx.update(challengeRef, {
        consumedAt: new Date(),
        updatedAt: new Date(),
      });
    }
    tx.update(userRef, {
      lastSignInAt: new Date(),
      updatedAt: new Date(),
    });
    writeAuditLog(tx, {
      actorUid: challenge.uid,
      actorRole: profile.role,
      action: "auth.otp_verified",
      entityType: "otpChallenge",
      entityId: parsed.data.challengeId,
      after: { consumedAt: new Date() },
    });
  });

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

  return response;
}