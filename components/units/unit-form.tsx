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

export interface UnitFormValues {
  unitNumber: string;
  rentAmount: string;
  depositAmount: string;
  status: string;
  notes: string;
}

export function UnitForm({
  action,
  mode,
  unitId,
  propertyOptions,
  defaultPropertyId,
  defaultValues,
  isOccupied = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  unitId?: string;
  propertyOptions: PropertyOption[];
  defaultPropertyId?: string;
  defaultValues?: Partial<UnitFormValues>;
  isOccupied?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (mode === "create" && state.entityId) {
      router.push(`/units/${state.entityId}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }, [state, mode, router]);

  return (
    <form action={formAction} className="space-y-4">
      {unitId ? <input type="hidden" name="unitId" value={unitId} /> : null}
      <FormAlert state={state} />

      {mode === "create" ? (
        <>
          <Field
            label="Property"
            htmlFor="propertyId"
            required
            error={state.fieldErrors?.propertyId}
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

          <Field
            label="Unit number"
            htmlFor="unitNumber"
            required
            error={state.fieldErrors?.unitNumber}
            hint="Short label used on invoices and SMS, e.g. A1 or B12."
          >
            <Input
              id="unitNumber"
              name="unitNumber"
              defaultValue={defaultValues?.unitNumber}
              placeholder="A1"
              required
              maxLength={20}
            />
          </Field>
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Monthly rent (KES)"
          htmlFor="rentAmount"
          required
          error={state.fieldErrors?.rentAmount}
        >
          <Input
            id="rentAmount"
            name="rentAmount"
            inputMode="decimal"
            defaultValue={defaultValues?.rentAmount}
            placeholder="45,000.00"
            required
          />
        </Field>

        <Field
          label="Deposit (KES)"
          htmlFor="depositAmount"
          required
          error={state.fieldErrors?.depositAmount}
        >
          <Input
            id="depositAmount"
            name="depositAmount"
            inputMode="decimal"
            defaultValue={defaultValues?.depositAmount}
            placeholder="90,000.00"
            required
          />
        </Field>
      </div>

      <Field label="Status" htmlFor="status" required error={state.fieldErrors?.status}>
        <NativeSelect
          id="status"
          name="status"
          defaultValue={defaultValues?.status ?? "vacant"}
          required
        >
          {isOccupied ? <option value="occupied">Occupied</option> : null}
          <option value="vacant">Vacant</option>
          <option value="maintenance">Under maintenance</option>
        </NativeSelect>
      </Field>

      <Field label="Notes" htmlFor="notes" error={state.fieldErrors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={defaultValues?.notes}
          placeholder="Meter number, access notes, condition."
          rows={3}
          maxLength={500}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create unit" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
