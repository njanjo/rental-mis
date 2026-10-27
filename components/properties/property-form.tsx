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
import { KENYA_COUNTIES } from "@/lib/kenya";
import type { StaffOption } from "@/lib/types/views";

export interface PropertyFormValues {
  name: string;
  address: string;
  county: string;
  managerIds: string[];
  notes: string;
}

export function PropertyForm({
  action,
  mode,
  propertyId,
  defaultValues,
  managerOptions,
  canAssignManagers,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  propertyId?: string;
  defaultValues?: Partial<PropertyFormValues>;
  managerOptions: StaffOption[];
  canAssignManagers: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (mode === "create" && state.entityId) {
      router.push(`/properties/${state.entityId}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }, [state, mode, router]);

  return (
    <form action={formAction} className="space-y-4">
      {propertyId ? (
        <input type="hidden" name="propertyId" value={propertyId} />
      ) : null}
      <FormAlert state={state} />

      <Field label="Property name" htmlFor="name" required error={state.fieldErrors?.name}>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name}
          placeholder="Kilimani Heights"
          required
          maxLength={120}
        />
      </Field>

      <Field label="Address" htmlFor="address" required error={state.fieldErrors?.address}>
        <Input
          id="address"
          name="address"
          defaultValue={defaultValues?.address}
          placeholder="Wood Avenue, Kilimani"
          required
          maxLength={240}
        />
      </Field>

      <Field label="County" htmlFor="county" required error={state.fieldErrors?.county}>
        <NativeSelect
          id="county"
          name="county"
          defaultValue={defaultValues?.county ?? ""}
          required
        >
          <option value="" disabled>
            Choose a county
          </option>
          {KENYA_COUNTIES.map((county) => (
            <option key={county.code} value={county.name}>
              {county.code} · {county.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {canAssignManagers ? (
        <Field
          label="Property managers"
          error={state.fieldErrors?.managerIds}
          hint="Managers only see the properties assigned to them."
        >
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
            {managerOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active managers available.
              </p>
            ) : (
              managerOptions.map((person) => (
                <label
                  key={person.uid}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="managerIds"
                    value={person.uid}
                    defaultChecked={defaultValues?.managerIds?.includes(person.uid)}
                    className="size-3.5 rounded border-input accent-primary"
                  />
                  <span>{person.fullName}</span>
                </label>
              ))
            )}
          </div>
        </Field>
      ) : null}

      <Field label="Notes" htmlFor="notes" error={state.fieldErrors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={defaultValues?.notes}
          placeholder="Access instructions, caretaker contact, anything staff should know."
          rows={3}
          maxLength={1000}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create property" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
