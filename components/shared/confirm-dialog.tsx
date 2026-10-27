"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/components/shared/form-alert";
import { IDLE_FORM_STATE, type FormState } from "@/lib/errors";

/**
 * Confirmation dialog that posts a server action with hidden identifiers and an
 * optional reason. The reason is validated server-side and lands in the audit
 * log, so it is never just a UI nicety.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  action,
  hiddenFields = {},
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Why is this change being made?",
  destructive = true,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  hiddenFields?: Record<string, string | undefined>;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
      toast.success(state.message ?? "Done");
      router.refresh();
    } else if (state.status === "error" && state.message) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground">{description}</div>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {Object.entries(hiddenFields).map(([name, value]) =>
            value === undefined ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}

          <FormAlert state={state} />

          {requireReason ? (
            <div className="space-y-1.5">
              <Label htmlFor={`reason-${title.replace(/\s+/g, "-")}`}>
                {reasonLabel}
              </Label>
              <Textarea
                id={`reason-${title.replace(/\s+/g, "-")}`}
                name="reason"
                rows={3}
                placeholder={reasonPlaceholder}
                required
                minLength={5}
                maxLength={500}
                disabled={pending}
              />
              {(state.fieldErrors?.reason ?? []).length > 0 ? (
                <p className="text-xs text-destructive">
                  {state.fieldErrors?.reason?.[0]}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
