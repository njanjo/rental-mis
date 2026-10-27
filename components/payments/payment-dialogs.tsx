"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Link2, Plus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
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
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/lib/dates";
import { IDLE_FORM_STATE } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from "@/lib/types";
import type {
  PaymentDetail,
  TenantOption,
  UnmatchedPaymentListItem,
} from "@/lib/types/views";
import {
  ignoreUnmatchedAction,
  recordManualReceiptAction,
  resolveUnmatchedAction,
  reversePaymentAction,
} from "@/app/(dashboard)/payments/actions";

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  mpesa: "M-Pesa",
  bank: "Bank transfer",
  manual: "Cash / other",
};

function providerNeedsReference(provider: PaymentProvider): boolean {
  return provider !== "manual";
}

/**
 * Enter a receipt that finance has already seen on a statement. The tenant is
 * chosen explicitly; if the payer is unknown, use the unmatched queue instead
 * of guessing.
 */
export function RecordReceiptDialog({
  tenantOptions,
  disabled,
}: {
  tenantOptions: TenantOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider>("mpesa");
  const [state, formAction] = useActionState(
    recordManualReceiptAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();
  const today = toDateInput(new Date());

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Receipt recorded");
    setOpen(false);
    router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled || tenantOptions.length === 0}>
          <Plus className="size-4" />
          Record receipt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a receipt</DialogTitle>
          <DialogDescription>
            For money already confirmed on M-Pesa or a bank statement. The
            receipt is allocated to the tenant&apos;s oldest unpaid invoices and
            any surplus becomes credit.
          </DialogDescription>
        </DialogHeader>

        {tenantOptions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            You need an active tenant before recording a receipt.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <Field
              label="Tenant"
              htmlFor="tenantId"
              required
              error={state.fieldErrors?.tenantId}
            >
              <NativeSelect id="tenantId" name="tenantId" required defaultValue="">
                <option value="" disabled>
                  Choose a tenant
                </option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.fullName}
                    {tenant.phoneE164 ? ` · ${tenant.phoneE164}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Provider"
                htmlFor="provider"
                required
                error={state.fieldErrors?.provider}
              >
                <NativeSelect
                  id="provider"
                  name="provider"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as PaymentProvider)
                  }
                  required
                >
                  {PAYMENT_PROVIDERS.map((value) => (
                    <option key={value} value={value}>
                      {PROVIDER_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                label="Amount (KES)"
                htmlFor="amount"
                required
                error={state.fieldErrors?.amount}
                hint="Use the exact amount on the statement."
              >
                <Input
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="4,500.00"
                  required
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Transaction reference"
                htmlFor="providerTransactionId"
                required={providerNeedsReference(provider)}
                error={state.fieldErrors?.providerTransactionId}
                hint={
                  providerNeedsReference(provider)
                    ? "The M-Pesa or bank reference. Duplicates are rejected."
                    : "Optional for cash; a reference is generated automatically."
                }
              >
                <Input
                  id="providerTransactionId"
                  name="providerTransactionId"
                  placeholder={
                    providerNeedsReference(provider)
                      ? "e.g. QGR7X2M9KL"
                      : "Generated if blank"
                  }
                  required={providerNeedsReference(provider)}
                />
              </Field>

              <Field
                label="Receipt date"
                htmlFor="receivedAt"
                required
                error={state.fieldErrors?.receivedAt}
              >
                <Input
                  id="receivedAt"
                  name="receivedAt"
                  type="date"
                  defaultValue={today}
                  required
                />
              </Field>
            </div>

            {provider === "bank" ? (
              <Field
                label="Bank code"
                htmlFor="bankCode"
                error={state.fieldErrors?.bankCode}
                hint="Optional short code, e.g. KCB or EQUITY."
              >
                <Input id="bankCode" name="bankCode" placeholder="KCB" />
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Payer name"
                htmlFor="payerName"
                error={state.fieldErrors?.payerName}
              >
                <Input id="payerName" name="payerName" placeholder="As on the receipt" />
              </Field>

              <Field
                label="Payer phone"
                htmlFor="payerPhone"
                error={state.fieldErrors?.payerPhone}
                hint="Optional; stored for future matching."
              >
                <Input
                  id="payerPhone"
                  name="payerPhone"
                  inputMode="tel"
                  placeholder="0712 345 678"
                />
              </Field>
            </div>

            <Field
              label="Note"
              htmlFor="narration"
              error={state.fieldErrors?.narration}
            >
              <Textarea
                id="narration"
                name="narration"
                rows={2}
                maxLength={500}
                placeholder="Optional narration from the statement"
              />
            </Field>

            <FormAlert state={state} />
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Recording…">
                <Plus className="size-4" />
                Record and allocate
              </SubmitButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Match a queued payment to a tenant, then allocate it in the same action. */
export function ResolveUnmatchedDialog({
  row,
  tenantOptions,
}: {
  row: UnmatchedPaymentListItem;
  tenantOptions: TenantOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    resolveUnmatchedAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Payment matched");
    setOpen(false);
    router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Link2 className="size-4" />
          Match
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Match this payment</DialogTitle>
          <DialogDescription>
            {formatMoney(row.amountMinor)} from{" "}
            {row.payerName ?? row.payerPhone ?? row.providerTransactionId}.
            Choose the tenant deliberately — the system will not guess from the
            name or amount.
          </DialogDescription>
        </DialogHeader>

        {tenantOptions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No active tenants are in your properties.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="unmatchedId" value={row.id} />
            <Field
              label="Tenant"
              htmlFor={`unmatched-tenant-${row.id}`}
              required
              error={state.fieldErrors?.tenantId}
            >
              <NativeSelect
                id={`unmatched-tenant-${row.id}`}
                name="tenantId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a tenant
                </option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.fullName}
                    {tenant.phoneE164 ? ` · ${tenant.phoneE164}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              label="Note"
              htmlFor={`unmatched-note-${row.id}`}
              error={state.fieldErrors?.note}
              hint="Optional audit note explaining the match."
            >
              <Textarea
                id={`unmatched-note-${row.id}`}
                name="note"
                rows={2}
                maxLength={300}
                placeholder="e.g. Tenant confirmed the M-Pesa message"
              />
            </Field>

            <FormAlert state={state} />
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Matching…">
                <Link2 className="size-4" />
                Match and allocate
              </SubmitButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function IgnoreUnmatchedDialog({
  row,
}: {
  row: UnmatchedPaymentListItem;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <Ban className="size-4" />
          Ignore
        </Button>
      }
      title="Ignore this payment?"
      description={
        <>
          {formatMoney(row.amountMinor)} stays recorded but leaves the open
          queue. It can still be reviewed later under the ignored filter. Give a
          reason for the audit trail.
        </>
      }
      confirmLabel="Ignore payment"
      action={ignoreUnmatchedAction}
      hiddenFields={{ unmatchedId: row.id }}
      requireReason
      reasonLabel="Why is this being ignored?"
      reasonPlaceholder="e.g. Bank reversal; no tenant payment received"
    />
  );
}

export function ReversePaymentDialog({
  payment,
}: {
  payment: PaymentDetail;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <Ban className="size-4" />
          Reverse payment
        </Button>
      }
      title="Reverse this payment?"
      description={
        <>
          This appends a reversing entry for {formatMoney(payment.amountMinor)},
          restores the affected invoice balances and removes untouched tenant
          credit. The original rows are kept for the audit trail. Reversal is
          blocked if any of the overpayment credit has already been used.
        </>
      }
      confirmLabel="Reverse payment"
      action={reversePaymentAction}
      hiddenFields={{ paymentId: payment.id }}
      requireReason
      reasonLabel="Reason for reversal"
      reasonPlaceholder="e.g. Cheque returned / duplicate receipt"
    />
  );
}
