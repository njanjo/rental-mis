"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE } from "@/lib/errors";
import type {
  BillingRules,
  ReminderRules,
  SmsTemplate,
} from "@/lib/types";
import { moneyInputValue } from "@/lib/validation/money";
import { EDITABLE_SMS_TEMPLATE_KEYS } from "@/lib/validation/settings";
import {
  updateBillingRulesAction,
  updateReminderRulesAction,
  updateSmsTemplatesAction,
} from "@/app/(dashboard)/settings/actions";

export function BillingRulesForm({ defaults }: { defaults: BillingRules }) {
  const [state, formAction] = useActionState(
    updateBillingRulesAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Allocation order"
          htmlFor="allocationStrategy"
          required
          error={state.fieldErrors?.allocationStrategy}
        >
          <NativeSelect
            id="allocationStrategy"
            name="allocationStrategy"
            defaultValue={defaults.allocationStrategy}
            required
          >
            <option value="oldest_first">Oldest invoice first</option>
            <option value="newest_first">Newest invoice first</option>
          </NativeSelect>
        </Field>

        <Field
          label="Overpayment"
          htmlFor="overpayment"
          required
          error={state.fieldErrors?.overpayment}
        >
          <NativeSelect
            id="overpayment"
            name="overpayment"
            defaultValue={defaults.overpayment}
            required
          >
            <option value="tenant_credit">Add to tenant credit</option>
            <option value="review" disabled>
              Hold for review (planned — not enforced yet)
            </option>
          </NativeSelect>
        </Field>
      </div>

      <div className="space-y-4 rounded-lg border p-3.5">
        <div className="flex items-center gap-2">
          <Checkbox
            id="lateFeeEnabled"
            name="lateFeeEnabled"
            defaultChecked={defaults.lateFeeEnabled}
          />
          <Label htmlFor="lateFeeEnabled">Enable late fees</Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Late fee amount"
            htmlFor="lateFeeAmount"
            error={state.fieldErrors?.lateFeeAmount}
            hint="KES charged per overdue invoice"
          >
            <Input
              id="lateFeeAmount"
              name="lateFeeAmount"
              defaultValue={moneyInputValue(defaults.lateFeeMinor)}
              placeholder="500.00"
              inputMode="decimal"
            />
          </Field>
          <Field
            label="Grace period (days)"
            htmlFor="gracePeriodDays"
            required
            error={state.fieldErrors?.gracePeriodDays}
            hint="0–60"
          >
            <Input
              id="gracePeriodDays"
              name="gracePeriodDays"
              defaultValue={String(defaults.gracePeriodDays)}
              inputMode="numeric"
              maxLength={2}
              required
            />
          </Field>
          <Field
            label="Invoice generation day"
            htmlFor="invoiceGenerationDay"
            required
            error={state.fieldErrors?.invoiceGenerationDay}
            hint="Day of month, 1–28"
          >
            <Input
              id="invoiceGenerationDay"
              name="invoiceGenerationDay"
              defaultValue={String(defaults.invoiceGenerationDay)}
              inputMode="numeric"
              maxLength={2}
              required
            />
          </Field>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Late fees are stored as policy but are not charged yet (Decision 13 —
        finance sign-off pending). Allocation changes apply to the next
        payment allocation.
      </p>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save billing rules</SubmitButton>
      </div>
    </form>
  );
}

export function ReminderRulesForm({ defaults }: { defaults: ReminderRules }) {
  const [state, formAction] = useActionState(
    updateReminderRulesAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Due-soon window (days before)"
          htmlFor="dueSoonDaysBefore"
          required
          error={state.fieldErrors?.dueSoonDaysBefore}
          hint="0–14"
        >
          <Input
            id="dueSoonDaysBefore"
            name="dueSoonDaysBefore"
            defaultValue={String(defaults.dueSoonDaysBefore)}
            inputMode="numeric"
            maxLength={2}
            required
          />
        </Field>
        <Field
          label="Arrears repeat interval (days)"
          htmlFor="overdueRepeatDays"
          required
          error={state.fieldErrors?.overdueRepeatDays}
          hint="1–30"
        >
          <Input
            id="overdueRepeatDays"
            name="overdueRepeatDays"
            defaultValue={String(defaults.overdueRepeatDays)}
            inputMode="numeric"
            maxLength={2}
            required
          />
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">
        The reminder job reads these windows on its next run.
      </p>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save reminder windows</SubmitButton>
      </div>
    </form>
  );
}

type EditableTemplateKey = (typeof EDITABLE_SMS_TEMPLATE_KEYS)[number];

const TEMPLATE_LABELS: Record<EditableTemplateKey, string> = {
  payment_receipt: "Payment receipt",
  rent_due_reminder: "Rent due reminder",
  arrears_notice: "Arrears notice",
};

const TEMPLATE_VARIABLES: Record<EditableTemplateKey, string> = {
  payment_receipt: "{{reference}}, {{amount}}, {{date}}, {{balanceNote}}",
  rent_due_reminder: "{{name}}, {{amount}}, {{dueDate}}, {{balanceNote}}",
  arrears_notice: "{{name}}, {{amount}}",
};

function isEditableTemplate(
  template: SmsTemplate,
): template is SmsTemplate & { key: EditableTemplateKey } {
  return (EDITABLE_SMS_TEMPLATE_KEYS as readonly string[]).includes(
    template.key,
  );
}

/**
 * One block per editable template. The action reads `key`, `body` and
 * `enabled` as parallel arrays, so every block must submit exactly one
 * `enabled` value: the checkbox posts "true" while checked and a hidden
 * input posts "false" while unchecked.
 */
function TemplateBlock({
  template,
}: {
  template: SmsTemplate & { key: EditableTemplateKey };
}) {
  const [enabled, setEnabled] = useState(template.enabled);
  const [length, setLength] = useState(template.body.length);
  const checkboxId = `template-enabled-${template.key}`;

  return (
    <div className="space-y-2.5 rounded-lg border p-3.5">
      <input type="hidden" name="key" value={template.key} />
      {enabled ? null : <input type="hidden" name="enabled" value="false" />}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{TEMPLATE_LABELS[template.key]}</p>
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            name="enabled"
            value="true"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          <Label htmlFor={checkboxId} className="text-muted-foreground">
            Enabled
          </Label>
        </div>
      </div>

      <Textarea
        name="body"
        defaultValue={template.body}
        rows={4}
        maxLength={480}
        onChange={(event) => setLength(event.target.value.length)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Variables: {TEMPLATE_VARIABLES[template.key]}
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {length}/480
        </span>
      </div>
    </div>
  );
}

export function SmsTemplatesForm({ templates }: { templates: SmsTemplate[] }) {
  const [state, formAction] = useActionState(
    updateSmsTemplatesAction,
    IDLE_FORM_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      {templates.filter(isEditableTemplate).map((template) => (
        <TemplateBlock key={template.key} template={template} />
      ))}

      <p className="text-xs text-muted-foreground">
        Keep the {"{{placeholders}}"} — unknown values are dropped when the
        message is sent. Disabled templates are skipped when messages are
        queued.
      </p>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save templates</SubmitButton>
      </div>
    </form>
  );
}
