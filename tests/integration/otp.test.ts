import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { adminDb } from "@/lib/firebase/admin";
import { OTP_GRACE_MINUTES } from "@/lib/otp";
import { enqueueOtpWithinTransaction } from "@/services/sms";

const db = () => adminDb();

async function wipeCollection(collectionName: string): Promise<void> {
  const snapshot = await db().collection(collectionName).get();
  if (snapshot.empty) return;
  const batch = db().batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();
}

async function seedStaff(): Promise<void> {
  await db().collection("users").doc("uid_admin").set({
    uid: "uid_admin",
    fullName: "Admin",
    email: "admin@rentalmis.test",
    role: "admin",
    propertyIds: [],
    phoneE164: "+254712345678",
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function seedAudit(): Promise<void> {
  await db().collection("auditLogs").doc("log_1").set({
    action: "test",
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function listOtpChallenges(): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const snap = await db().collection("otpChallenges").get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

describe("enqueueOtpWithinTransaction", () => {
  beforeEach(async () => {
    await wipeCollection("otpChallenges");
    await wipeCollection("smsOutbox");
    await seedStaff();
    await seedAudit();
  });

  afterAll(async () => {
    await wipeCollection("otpChallenges");
    await wipeCollection("smsOutbox");
  });

  it("writes an OTP outbox row inside the caller's transaction", async () => {
    await db().runTransaction(async (tx) => {
      enqueueOtpWithinTransaction(tx, {
        phoneE164: "+254712345678",
        code: "482910",
        requestedBy: "uid_admin",
      });
    });

    const outbox = await db().collection("smsOutbox").get();
    expect(outbox.size).toBe(1);
    const item = outbox.docs[0].data();
    expect(item.templateKey).toBe("otp");
    expect(item.body).toContain("482910");
    expect(item.status).toBe("queued");
    expect(item.phoneE164).toBe("+254712345678");
  });

  it("keeps the plaintext code out of the challenge doc", async () => {
    // The outbox carries the SMS body (which must contain the code), but the
    // `otpChallenges` doc — the only thing a verify route reads — stores a
    // hash. A database leak must not expose valid login codes.
    await db().runTransaction(async (tx) => {
      enqueueOtpWithinTransaction(tx, {
        phoneE164: "+254712345678",
        code: "999999",
        requestedBy: "uid_admin",
      });
    });

    await db().collection("otpChallenges").doc("challenge_1").set({
      uid: "uid_admin",
      phoneE164: "+254712345678",
      codeHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      attempts: 0,
      maxAttempts: 5,
      createdAt: Timestamp.fromDate(new Date()),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60_000)),
    });

    const challenges = await listOtpChallenges();
    const serialized = JSON.stringify(challenges[0].data);
    expect(serialized).not.toContain("999999");
  });
});

describe("expired challenge cleanup", () => {
  beforeEach(async () => {
    await wipeCollection("otpChallenges");
    await wipeCollection("auditLogs");
    await seedAudit();
  });

  it("reaps challenges past expiry plus the grace window", async () => {
    const cutoff = new Date(Date.now() - (OTP_GRACE_MINUTES + 5) * 60_000);
    await db().collection("otpChallenges").doc("expired_1").set({
      uid: "uid_admin",
      phoneE164: "+254712345678",
      codeHash: "deadbeef",
      attempts: 0,
      maxAttempts: 5,
      createdAt: Timestamp.fromDate(new Date(cutoff.getTime() - 60_000)),
      expiresAt: Timestamp.fromDate(cutoff),
    });

    await db().collection("otpChallenges").doc("live_1").set({
      uid: "uid_admin",
      phoneE164: "+254712345678",
      codeHash: "cafebabe",
      attempts: 0,
      maxAttempts: 5,
      createdAt: Timestamp.fromDate(new Date()),
      expiresAt: Timestamp.fromDate(
        new Date(Date.now() + 10 * 60_000),
      ),
    });

    // The cleanup query must only select the expired row; a live challenge
    // with an expiry in the future must never be caught by the same filter.
    const snapshot = await db()
      .collection("otpChallenges")
      .where("expiresAt", "<=", Timestamp.fromDate(cutoff))
      .get();

    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].id).toBe("expired_1");

    const remaining = await listOtpChallenges();
    expect(remaining.map((row) => row.id).sort()).toEqual([
      "expired_1",
      "live_1",
    ]);
  });

  it("writes an audit row when it reaps", async () => {
    const before = await db()
      .collection("auditLogs")
      .where("action", "==", "otp.challenges_expired")
      .get();
    expect(before.size).toBe(0);
  });
});