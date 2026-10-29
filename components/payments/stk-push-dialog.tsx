"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";

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
import { IDLE_FORM_STATE } from "@/lib/errors";
import type { TenantOption } from "@/lib/types/views";
import { requestStkPushAction } from "@/app/(dashboard)/payments/actions";

/**
 * Send an M-Pesa STK prompt. This action separates "asking for money" from
 * "recording money": Daraja answers with a CheckoutRequestID immediately, and
 * the receipt — if the customer pays — arrives on the webhook later. Nothing
 * here touches the ledger.
 */
export function RequestMpesaDialog({
  tenantOptions,
  disabled,
}: {
  tenantOptions: TenantOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [state, formAction] = useActionState(
    requestStkPushAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  const selectedTenant = tenantOptions.find((tenant) => tenant.id === tenantId);

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Prompt sent");
    setOpen(false);
    router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || tenantOptions.length === 0}
        >
          <Smartphone className="size-4" />
          Send M-Pesa prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request an M-Pesa payment</DialogTitle>
          <DialogDescription>
            The tenant&apos;s phone gets a Lipa na M-Pesa prompt for this amount.
            The receipt appears in payments only after Safaricom confirms the
            payment back to us.
          </DialogDescription>
        </DialogHeader>

        {tenantOptions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            You need an active tenant before requesting a payment.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" ? <FormAlert state={state} /> : null}

            <Field
              label="Tenant"
              htmlFor="stk-tenantId"
              required
              error={state.fieldErrors?.tenantId}
            >
              <NativeSelect
                id="stk-tenantId"
                name="tenantId"
                required
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
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
              label="Amount (KES)"
              htmlFor="stk-amount"
              required
              error={state.fieldErrors?.amount}
              hint="The amount the tenant is asked to pay, e.g. the rent due."
            >
              <Input
                id="stk-amount"
                name="amount"
                inputMode="decimal"
                placeholder="15,000"
                required
              />
            </Field>

            <Field
              label="Phone to bill"
              htmlFor="stk-overridePhone"
              error={state.fieldErrors?.overridePhone}
              hint={
                selectedTenant?.phoneE164
                  ? `Leave blank to bill ${selectedTenant.phoneE164}.`
                  : "Optional; otherwise the tenant's own phone is billed."
              }
            >
              <Input
                id="stk-overridePhone"
                name="overridePhone"
                inputMode="tel"
                placeholder={selectedTenant?.phoneE164 ?? "0712 345 678"}
              />
            </Field>

            <Field
              label="Note"
              htmlFor="stk-note"
              error={state.fieldErrors?.note}
              hint="Optional; up to 60 characters appear on the phone prompt."
            >
              <Input
                id="stk-note"
                name="note"
                maxLength={60}
                placeholder="e.g. October rent"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <SubmitButton pendingLabel="Sending…">
                Send prompt
              </SubmitButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
