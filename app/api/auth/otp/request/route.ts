/**
 * OTP request — verify the ID token, then send a 6-digit code via Beam SMS.
 *
 * This route does NOT mint a session. It only confirms the credential is
 * valid and enqueues an OTP challenge. The session is minted by
 * `POST /api/auth/otp/verify` after the code is accepted.
 *
 * The client signs in with Firebase Auth first and sends the resulting ID
 * token. This route verifies it and reads the staff profile from Firestore.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { fingerprintClient, fingerprintFromRequest } from "@/lib/auth/client-fingerprint";
import { enqueueOtpWithinTransaction } from "@/services/sms";
import {
  generateOtp,
  hashOtp,
  otpCooldownUntil,
  otpExpiresAt,
  OTP_MAX_ATTEMPTS,
  OTP_REQUEST_COOLDOWN_SECONDS,
} from "@/lib/otp";
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
    return NextResponse.json(
      { error: "A valid ID token is required." },
      { status: 400 },
    );
  }

  // 1. Verify the Firebase ID token.
  let uid: string;
  let email: string;
  try {
    const decoded = await adminAuth().verifyIdToken(parsed.data.idToken);
    uid = decoded.uid;
    email = decoded.email ?? "";
  } catch {
    return NextResponse.json(
      { error: "Could not start a session. Please sign in again." },
      { status: 401 },
    );
  }

  if (!email) {
    return NextResponse.json(
      { error: "That account has no email on file." },
      { status: 403 },
    );
  }

  // 2. Look up the staff profile by uid.
  const userRef = adminDb().collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    return NextResponse.json(
      { error: "This account is not provisioned. Contact an administrator." },
      { status: 403 },
    );
  }

  const profile = userSnap.data() as UserProfile;

  if (!profile.active) {
    return NextResponse.json(
      { error: "This account has been deactivated." },
      { status: 403 },
    );
  }

  if (!profile.phoneE164) {
    return NextResponse.json(
      {
        error:
          "This account has no phone number on file. Contact an administrator.",
      },
      { status: 403 },
    );
  }

  const phoneE164: string = profile.phoneE164;

  // 3. Rate limit: reject requests inside the cooldown window.
  const now = new Date();
  const recent = await adminDb()
    .collection("otpChallenges")
    .where("uid", "==", uid)
    .where("createdAt", ">", new Date(now.getTime() - OTP_REQUEST_COOLDOWN_SECONDS * 1000))
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (!recent.empty) {
    const created = recent.docs[0].data().createdAt?.toDate?.() ?? new Date(0);
    const remaining = Math.max(
      0,
      Math.ceil((otpCooldownUntil(now).getTime() - created.getTime()) / 1000),
    );
    return NextResponse.json(
      {
        error: `Wait ${remaining}s before requesting another code.`,
        retryAfter: remaining,
      },
      { status: 429 },
    );
  }

  // 4. Generate the OTP and store the challenge. The challenge is bound to the
  // machine that requested it, so a stolen challenge id cannot be verified
  // from a different machine.
  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = otpExpiresAt(now);
  const clientFingerprint = fingerprintClient(fingerprintFromRequest(request));

  const challengeRef = adminDb().collection("otpChallenges").doc();

  try {
    await adminDb().runTransaction(async (tx) => {
      tx.set(challengeRef, {
        uid,
        phoneE164,
        codeHash,
        attempts: 0,
        maxAttempts: OTP_MAX_ATTEMPTS,
        createdAt: new Date(),
        expiresAt,
        ...(clientFingerprint ? { clientFingerprint } : {}),
      });

      enqueueOtpWithinTransaction(tx, {
        phoneE164,
        code,
        requestedBy: uid,
      });
    });
  } catch (cause) {
    console.error("[auth/otp/request] failed to store challenge", cause);
    return NextResponse.json(
      { error: "Could not send the verification code. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, challengeId: challengeRef.id, phoneE164: maskPhone(phoneE164) });
}

/** Show the last four digits only; the full number lives in the challenge doc. */
function maskPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  if (digits.length <= 4) return phoneE164;
  const visible = digits.slice(-4);
  return `+${"X".repeat(digits.length - 4 - 1)}${visible}`;
}