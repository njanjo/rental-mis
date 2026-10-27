"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Ban } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IDLE_FORM_STATE } from "@/lib/errors";
import type { InvoiceDetail } from "@/lib/types/views";
import {
  generateInvoicesAction,
  voidInvoiceAction,
} from "@/app/(dashboard)/invoices/actions";

/** Month picker that creates every missing invoice for one billing period. */
export function GenerateInvoicesDialog({
  defaultPeriod,
  disabled,
}: {
  defaultPeriod: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    generateInvoicesAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Invoices generated");
    setOpen(false);
    router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <CalendarPlus className="size-4" />
          Generate month
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate invoices</DialogTitle>
          <DialogDescription>
            Creates one invoice per active lease for the chosen month. Leases
            that started or ended mid-month are prorated by calendar day, and
            months that already have invoices are left untouched.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <Field
            label="Billing month"
            htmlFor="period"
            error={state.fieldErrors?.period}
            hint="Rerunning a month is safe — existing invoices are skipped."
          >
            <Input
              id="period"
              name="period"
              type="month"
              defaultValue={defaultPeriod}
              required
            />
          </Field>

          <FormAlert state={state} />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Generating…">
              <CalendarPlus className="size-4" />
              Generate
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Voiding needs a written reason. It is blocked once any payment has been
 * allocated, so the payment ledger is never rewritten.
 */
export function VoidInvoiceDialog({ invoice }: { invoice: InvoiceDetail }) {
  const blocked = invoice.amountPaidMinor > 0 || invoice.storedStatus === "paid";
  if (invoice.storedStatus === "void" || blocked) return null;

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <Ban className="size-4" />
          Void invoice
        </Button>
      }
      title="Void this invoice?"
      description={
        <>
          The invoice stays on record with status <strong>void</strong> and a
          zero balance. Voiding is blocked once a payment has been allocated to
          it.
        </>
      }
      confirmLabel="Void invoice"
      action={voidInvoiceAction}
      hiddenFields={{ invoiceId: invoice.id }}
      requireReason
      reasonLabel="Reason for voiding"
      reasonPlaceholder="e.g. Duplicate invoice raised in error"
    />
  );
}
