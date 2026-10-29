import { NextResponse } from "next/server";

import { callbackSecretMatches } from "@/lib/mpesa";
import {
  generateReminders,
  pollDeliveryReports,
  runOutboxWorker,
  smsSystemActor,
} from "@/services/sms";

/**
 * Protected cron entrypoint for Phase 6 automation. Register a daily schedule
 * (e.g. Vercel Cron hitting `GET {base}/api/cron/{CRON_SECRET}?job=all`) or
 * call single jobs explicitly: `drain`, `poll` or `reminders`.
 *
 * Uses the same shared-secret-in-path pattern as the M-Pesa webhooks so the
 * route stays unguessable without config.
 *
 * Job summary:
 * - drain: send queued SMS through Beam (retries with backoff, then dead-letter)
 * - poll: reconcile Beam delivery reports for sent messages
 * - reminders: queue due-soon + overdue rent notices (idempotent campaign ids)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = "drain" | "poll" | "reminders" | "all";

function parseJob(request: Request): Job {
  const value = new URL(request.url).searchParams.get("job");
  return value === "drain" || value === "poll" || value === "reminders"
    ? value
    : "all";
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
  const results: Record<string, unknown> = { job, startedAt: new Date().toISOString() };

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

  results.finishedAt = new Date().toISOString();
  return NextResponse.json(results);
}
