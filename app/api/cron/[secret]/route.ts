import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/accounts";
import { callbackSecretMatches } from "@/lib/mpesa";
import {
  generateReminders,
  pollDeliveryReports,
  runOutboxWorker,
} from "@/services/sms";

/**
 * Protected cron entrypoint for Phase 6 automation. Register a daily schedule
 * (e.g. Vercel Cron hitting `GET {base}/api/cron/{CRON_SECRET}?job=all`) or
 * call single jobs explicitly: `drain`, `poll` or `reminders`.
 *
 * Uses the same shared-secret-in-path pattern as the M-Pesa webhooks so the
 * route stays unguessable without config.
 *
 * Multi-tenant model: every job runs per active account. `drain` and `poll`
 * loop accounts internally and return a combined outcome; `reminders` is
 * invoked once per account here so each account's cadence and data boundary
 * hold. One account failing never blocks the others.
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

function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
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
    results.drain = await outcomeOf(runOutboxWorker());
  }

  if (job === "all" || job === "poll") {
    results.poll = await outcomeOf(pollDeliveryReports());
  }

  if (job === "all" || job === "reminders") {
    const accounts = await listAccounts("active");
    results.accounts = accounts.length;
    results.reminders = await outcomeOf(
      Promise.all(
        accounts.map(async (account) => ({
          accountId: account.id,
          outcome: await generateReminders(account.id).catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          })),
        })),
      ),
    );
  }

  results.finishedAt = new Date().toISOString();
  return NextResponse.json(results);
}
