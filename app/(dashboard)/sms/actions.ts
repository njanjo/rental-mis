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
import {
  generateReminders,
  pollDeliveryReports,
  runOutboxWorker,
  smsSystemActor,
} from "@/services/sms";

/**
 * Manual triggers for the Phase 6 automation jobs. The same three code paths
 * run from the protected cron route; these actions exist so staff can drain
 * the outbox or generate reminders immediately without waiting for the
 * scheduler.
 */

const SMS_JOBS = ["drain", "poll", "reminders"] as const;
type SmsJob = (typeof SMS_JOBS)[number];

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

    const outcome = await generateReminders(smsSystemActor(), new Date());
    revalidateSms();
    return formSuccess(
      `Queued ${outcome.dueSoon} due-soon and ${outcome.overdue} overdue notices${outcome.skipped > 0 ? ` (${outcome.skipped} skipped)` : ""}.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}
