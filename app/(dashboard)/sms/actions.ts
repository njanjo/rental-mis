"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import {
  formSuccess,
  ServiceError,
  toFormState,
  type FormState,
} from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  enqueueOtpWithinTransaction,
  generateReminders,
  pollDeliveryReports,
  runOutboxWorker,
  smsSystemActor,
  type SendOutcome,
} from "@/services/sms";
import { generateOtp } from "@/lib/otp";

/**
 * Manual triggers for the Phase 6 automation jobs. The same code paths run from
 * the protected cron route; these actions exist so staff can drain the
 * outbox, check deliveries, generate reminders, or send an OTP smoke test
 * immediately without waiting for the scheduler.
 */

const SMS_JOBS = ["drain", "poll", "reminders", "test_otp"] as const;
type SmsJob = (typeof SMS_JOBS)[number];

/**
 * Recipient for the manual OTP smoke test. Env-configured, never hardcoded to a
 * production number: unset means "do not send", so a misconfigured deployment
 * cannot silently fire a code at a real phone.
 */
const DEFAULT_TEST_OTP_PHONE = "+254796985336";

function testOtpPhone(): string {
  const configured = process.env.TEST_SMS_PHONE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TEST_OTP_PHONE;
}

function jobFromForm(formData: FormData): SmsJob {
  const value = formData.get("job")?.toString() ?? "";
  if ((SMS_JOBS as readonly string[]).includes(value)) {
    return value as SmsJob;
  }
  throw new ServiceError("validation", "Unknown SMS job.");
}

function revalidateSms(): void {
  revalidatePath("/sms");
}

/**
 * Result of the OTP smoke test: the phone it was addressed to, the code that
 * was rendered into the body (so callers can assert on the outbox row), and
 * what the worker did with it.
 */
export interface TestOtpResult {
  phoneE164: string;
  code: string;
  outcome: SendOutcome;
}

/**
 * Core of the OTP smoke test. Accepts the authenticated user and an injectable
 * fetch so tests can drive it without a real session cookie or a network call
 * to Beam.
 *
 * This is the only path that enqueues an OTP outside a real login; it exists
 * to prove the Beam path delivers, not to mint a usable session. The enqueue
 * is deliberately not wrapped in a try/catch (unlike enqueueSmsWithinTransaction,
 * which swallows so notifications never break a payment commit): a test that
 * cannot queue must surface as an error.
 */
export async function sendTestOtp(
  user: { uid: string },
  options: {
    fetchImpl?: typeof fetch;
    phoneE164?: string;
  } = {},
): Promise<TestOtpResult> {
  const phoneE164 = options.phoneE164 ?? testOtpPhone();
  const code = generateOtp();

  await adminDb().runTransaction(async (tx) => {
    enqueueOtpWithinTransaction(tx, {
      phoneE164,
      code,
      requestedBy: user.uid,
    });
  });

  const outcome = await runOutboxWorker(options.fetchImpl ?? fetch);

  return { phoneE164, code, outcome };
}

export async function runSmsJobAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_sms");
    const job = jobFromForm(formData);

    if (job === "drain") {
      const outcome = await runOutboxWorker();
      revalidateSms();
      const message =
        outcome.sent + outcome.retried + outcome.dead === 0
          ? "No messages were ready to send."
          : `Sent ${outcome.sent}, retrying ${outcome.retried}, dead-lettered ${outcome.dead}.`;
      return formSuccess(message);
    }

    if (job === "poll") {
      const outcome = await pollDeliveryReports();
      revalidateSms();
      const message =
        outcome.checkable === 0
          ? "No sent messages awaiting confirmation."
          : `Checked ${outcome.checkable}: ${outcome.delivered} delivered, ${outcome.failed} failed.`;
      return formSuccess(message);
    }

    if (job === "reminders") {
      const outcome = await generateReminders(smsSystemActor(), new Date());
      revalidateSms();
      return formSuccess(
        `Queued ${outcome.dueSoon} due-soon and ${outcome.overdue} overdue notices${outcome.skipped > 0 ? ` (${outcome.skipped} skipped)` : ""}.`,
      );
    }

    const result = await sendTestOtp(user);
    revalidateSms();

    const total = result.outcome.sent + result.outcome.retried + result.outcome.dead;
    const detail =
      total === 0
        ? "Nothing was ready to send — check the outbox for the queued OTP."
        : `Sent ${result.outcome.sent}, retrying ${result.outcome.retried}, dead-lettered ${result.outcome.dead}.`;
    return formSuccess(`Test OTP queued for ${result.phoneE164}. ${detail}`);
  } catch (error) {
    return toFormState(error);
  }
}