"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addMonths, parseDateInput, toDateInput, todayIsoDate } from "@/lib/dates";
import { IDLE_FORM_STATE, type FormState } from "@/lib/errors";
import type { TenantOption, UnitOption } from "@/lib/types/views";
import { moneyInputValue } from "@/lib/validation/money";

function defaultEndDate(months = 12): string {
  const start = parseDateInput(todayIsoDate());
  return start ? toDateInput(addMonths(start, months)) : "";
}

export function LeaseForm({
  action,
  tenantOptions,
  unitOptions,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  tenantOptions: TenantOption[];
  unitOptions: UnitOption[];
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();
  const [unitId, setUnitId] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (state.entityId) {
      router.push(`/leases/${state.entityId}`);
      router.refresh();
    }
  }, [state, router]);

  function selectUnit(nextUnitId: string) {
    setUnitId(nextUnitId);
    const unit = unitOptions.find((option) => option.id === nextUnitId);
    if (!unit) return;
    // The asking rent is a sensible starting point; staff can still agree a
    // different figure before saving.
    setRentAmount(moneyInputValue(unit.rentAmountMinor));
    setDepositAmount(moneyInputValue(unit.depositAmountMinor));
  }

  if (unitOptions.length === 0 || tenantOptions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        A lease needs an active tenant and a vacant unit. Add one of each first.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <Field
        label="Unit"
        htmlFor="unitId"
        required
        error={state.fieldErrors?.unitId}
        hint="Only vacant units in properties you can manage are listed."
      >
        <NativeSelect
          id="unitId"
          name="unitId"
          value={unitId}
          onChange={(event) => selectUnit(event.target.value)}
          required
        >
          <option value="" disabled>
            Choose a vacant unit
          </option>
          {unitOptions.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.propertyName} · {unit.unitNumber}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field
        label="Tenant"
        htmlFor="tenantId"
        required
        error={state.fieldErrors?.tenantId}
      >
        <NativeSelect id="tenantId" name="tenantId" defaultValue="" required>
          <option value="" disabled>
            Choose an active tenant
          </option>
          {tenantOptions.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.fullName} — {tenant.phoneE164}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Start date"
          htmlFor="startDate"
          required
          error={state.fieldErrors?.startDate}
        >
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={todayIsoDate()}
            required
          />
        </Field>

        <Field
          label="End date"
          htmlFor="endDate"
          required
          error={state.fieldErrors?.endDate}
        >
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={defaultEndDate()}
            required
          />
        </Field>
      </div>

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
            value={rentAmount}
            onChange={(event) => setRentAmount(event.target.value)}
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
            value={depositAmount}
            onChange={(event) => setDepositAmount(event.target.value)}
            placeholder="90,000.00"
            required
          />
        </Field>
      </div>

      <Field
        label="Rent due day"
        htmlFor="dueDay"
        required
        error={state.fieldErrors?.dueDay}
        hint="Day of the month invoices fall due, 1–28."
      >
        <Input
          id="dueDay"
          name="dueDay"
          type="number"
          min={1}
          max={28}
          defaultValue={5}
          required
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Creating…">Create lease</SubmitButton>
      </div>
    </form>
  );
}

export function LeaseTermsForm({
  action,
  leaseId,
  defaultValues,
  mode,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  leaseId: string;
  defaultValues: { rentAmount: number; depositAmount: number; dueDay: number };
  mode: "pending" | "active";
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="leaseId" value={leaseId} />
      <FormAlert state={state} />

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
            defaultValue={moneyInputValue(defaultValues.rentAmount)}
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
            defaultValue={moneyInputValue(defaultValues.depositAmount)}
            required
          />
        </Field>
      </div>

      <Field
        label="Rent due day"
        htmlFor="dueDay"
        required
        error={state.fieldErrors?.dueDay}
      >
        <Input
          id="dueDay"
          name="dueDay"
          type="number"
          min={1}
          max={28}
          defaultValue={defaultValues.dueDay}
          required
        />
      </Field>

      <Field
        label="Reason"
        htmlFor="reason"
        required
        error={state.fieldErrors?.reason}
        hint={
          mode === "active"
            ? "The change is audited and applies to invoices generated after today."
            : "Recorded in the audit log with the old and new terms."
        }
      >
        <Textarea
          id="reason"
          name="reason"
          rows={3}
          placeholder="Why are the terms changing?"
          required
          minLength={5}
          maxLength={500}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save terms</SubmitButton>
      </div>
    </form>
  );
}

export function LeaseRenewForm({
  action,
  leaseId,
  defaultValues,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  leaseId: string;
  defaultValues: {
    startDate: string;
    endDate: string;
    rentAmount: number;
    dueDay: number;
  };
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (state.entityId) {
      router.push(`/leases/${state.entityId}`);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="leaseId" value={leaseId} />
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="New start date"
          htmlFor="renewStartDate"
          required
          error={state.fieldErrors?.startDate}
        >
          <Input
            id="renewStartDate"
            name="startDate"
            type="date"
            defaultValue={defaultValues.startDate}
            required
          />
        </Field>

        <Field
          label="New end date"
          htmlFor="renewEndDate"
          required
          error={state.fieldErrors?.endDate}
        >
          <Input
            id="renewEndDate"
            name="endDate"
            type="date"
            defaultValue={defaultValues.endDate}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Monthly rent (KES)"
          htmlFor="renewRentAmount"
          required
          error={state.fieldErrors?.rentAmount}
        >
          <Input
            id="renewRentAmount"
            name="rentAmount"
            inputMode="decimal"
            defaultValue={moneyInputValue(defaultValues.rentAmount)}
            required
          />
        </Field>

        <Field
          label="Rent due day"
          htmlFor="renewDueDay"
          required
          error={state.fieldErrors?.dueDay}
        >
          <Input
            id="renewDueDay"
            name="dueDay"
            type="number"
            min={1}
            max={28}
            defaultValue={defaultValues.dueDay}
            required
          />
        </Field>
      </div>

      <Field
        label="Reason"
        htmlFor="renewReason"
        required
        error={state.fieldErrors?.reason}
        hint="The renewal starts as pending; activating it expires the current lease."
      >
        <Textarea
          id="renewReason"
          name="reason"
          rows={3}
          placeholder="Tenant renewed for another year at the new rent."
          required
          minLength={5}
          maxLength={500}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Drafting…">Draft renewal</SubmitButton>
      </div>
    </form>
  );
}
