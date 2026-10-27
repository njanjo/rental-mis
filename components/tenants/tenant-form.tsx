"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, type FormState } from "@/lib/errors";
import type { PropertyOption } from "@/lib/types/views";

export interface TenantFormValues {
  fullName: string;
  phone: string;
  nationalIdLast4: string;
  consentSms: boolean;
  notes: string;
}

export function TenantForm({
  action,
  mode,
  tenantId,
  propertyOptions,
  defaultPropertyId,
  defaultValues,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  tenantId?: string;
  propertyOptions: PropertyOption[];
  defaultPropertyId?: string;
  defaultValues?: Partial<TenantFormValues>;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (mode === "create" && state.entityId) {
      router.push(`/tenants/${state.entityId}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }, [state, mode, router]);

  return (
    <form action={formAction} className="space-y-4">
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <FormAlert state={state} />

      {mode === "create" ? (
        <Field
          label="Property"
          htmlFor="propertyId"
          required
          error={state.fieldErrors?.propertyId}
          hint="Tenants are scoped to their property. A lease can move them later."
        >
          <NativeSelect
            id="propertyId"
            name="propertyId"
            defaultValue={defaultPropertyId ?? ""}
            required
          >
            <option value="" disabled>
              Choose a property
            </option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field
        label="Full name"
        htmlFor="fullName"
        required
        error={state.fieldErrors?.fullName}
      >
        <Input
          id="fullName"
          name="fullName"
          defaultValue={defaultValues?.fullName}
          placeholder="Grace Wanjiru"
          required
          maxLength={120}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Phone"
          htmlFor="phone"
          required
          error={state.fieldErrors?.phone}
          hint="Used to match M-Pesa payments to this tenant."
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={defaultValues?.phone}
            placeholder="0712 345 678"
            required
          />
        </Field>

        <Field
          label="National ID (last 4)"
          htmlFor="nationalIdLast4"
          error={state.fieldErrors?.nationalIdLast4}
          hint="Only the last four digits are stored."
        >
          <Input
            id="nationalIdLast4"
            name="nationalIdLast4"
            inputMode="numeric"
            defaultValue={defaultValues?.nationalIdLast4}
            placeholder="4821"
            maxLength={4}
            pattern="\d{4}"
          />
        </Field>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          name="consentSms"
          defaultChecked={defaultValues?.consentSms ?? true}
          className="mt-0.5 size-3.5 rounded border-input accent-primary"
        />
        <span>
          <span className="font-medium">SMS consent</span>
          <span className="block text-xs text-muted-foreground">
            The tenant agrees to rent reminders and receipts by SMS. Never message
            a tenant who has opted out.
          </span>
        </span>
      </label>

      <Field label="Notes" htmlFor="notes" error={state.fieldErrors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={defaultValues?.notes}
          placeholder="Emergency contact, workplace, anything staff should know."
          rows={3}
          maxLength={1000}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create tenant" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
