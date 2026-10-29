"use client";

import { useActionState, useEffect } from "react";
import { RefreshCw, Send, Timer } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/shared/submit-button";
import { IDLE_FORM_STATE } from "@/lib/errors";
import { runSmsJobAction } from "@/app/(dashboard)/sms/actions";

/**
 * Manual triggers for the three SMS automation jobs. Each posts straight to
 * the shared `runSmsJobAction`; the count summary comes back as the form
 * message so staff see what the run did without a page change.
 */
export function RunSmsJobButtons() {
  const [state, formAction] = useActionState(runSmsJobAction, IDLE_FORM_STATE);

  useEffect(() => {
    if (state.status === "success" && state.message) {
      toast.success(state.message);
    }
  }, [state]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === "error" && state.message ? (
        <span className="text-sm text-destructive">{state.message}</span>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="job" value="drain" />
        <SubmitButton variant="outline" size="sm" pendingLabel="Sending…">
          <Send className="size-4" />
          Run sender
        </SubmitButton>
      </form>
      <form action={formAction}>
        <input type="hidden" name="job" value="poll" />
        <SubmitButton variant="outline" size="sm" pendingLabel="Checking…">
          <RefreshCw className="size-4" />
          Check deliveries
        </SubmitButton>
      </form>
      <form action={formAction}>
        <input type="hidden" name="job" value="reminders" />
        <SubmitButton variant="outline" size="sm" pendingLabel="Queuing…">
          <Timer className="size-4" />
          Generate reminders
        </SubmitButton>
      </form>
    </div>
  );
}
