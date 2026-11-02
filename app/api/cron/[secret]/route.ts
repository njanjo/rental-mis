import { NextResponse } from "next/server";

import { callbackSecretMatches } from "@/lib/mpesa";
import { OTP_GRACE_MINUTES } from "@/lib/otp";
import { adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/audit";
import {
  generateReminders,
  pollDeliveryReports,
  runOutboxWorker,
  smsSystemActor,
} from "@/services/sms";

/**
 * Protected cron entrypoint for Phase 6 automation. Register a daily schedule
 * (e.g. Vercel Cron hitting `GET {base}/api/cron/{CRON_SECRET}?job=all`) or
 * call single jobs explicitly: `drain`, `poll`, `reminders` or `otp_cleanup`.
 *
 * Uses the same shared-secret-in-path pattern as the M-Pesa webhooks so the
 * route stays unguessable without config.
 *
 * Job summary:
 * - drain: send queued SMS through Beam (retries with backoff, then dead-letter)
 * - poll: reconcile Beam delivery reports for sent messages
 * - reminders: queue due-soon + overdue rent notices (idempotent campaign ids)
 * - otp_cleanup: reap expired OTP challenges so the collection stays small
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = "drain" | "poll" | "reminders" | "otp_cleanup" | "all";

function parseJob(request: Request): Job {
  const value = new URL(request.url).searchParams.get("job");
  return value === "drain" || value === "poll" || value === "reminders" || value === "otp_cleanup"
    ? value
    : "all";
}

async function cleanupExpiredOtp(now: Date): Promise<{ deleted: number }> {
  const db = adminDb();
  const cutoff = new Date(now.getTime() - OTP_GRACE_MINUTES * 60_000);
  const snapshot = await db
    .collection("otpChallenges")
    .where("expiresAt", "<=", cutoff)
    .get();

  if (snapshot.empty) return { deleted: 0 };

  let deleted = 0;
  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    deleted += 1;
  }
  await batch.commit();

  await db.runTransaction(async (tx) => {
    writeAuditLog(tx, {
      actorUid: "system:cron",
      actorRole: "admin",
      action: "otp.challenges_expired",
      entityType: "otpChallenge",
      entityId: "batch",
      after: { deleted, cutoff: cutoff.toISOString() },
    });
  });

  return { deleted };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ secret: string }> },
) {
  const expected = process.env.CRON_SECRET?.trim();
  const { secret } = await context.params;
  if (!expected || !callbackSecretMatches(expected, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const job = parseJob(request);
  const now = new Date();
  const results: Record<string, unknown> = { job, startedAt: now.toISOString() };

  if (job === "all" || job === "drain") {
    results.drain = await runOutboxWorker().catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (job === "all" || job === "poll") {
    results.poll = await pollDeliveryReports().catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (job === "all" || job === "reminders") {
    results.reminders = await generateReminders(smsSystemActor()).catch(
      (error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  if (job === "all" || job === "otp_cleanup") {
    results.otp_cleanup = await cleanupExpiredOtp(now).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  results.finishedAt = new Date().toISOString();
  return NextResponse.json(results);
}
