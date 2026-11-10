import { z } from "zod";

import { moneyMinorOrZero } from "@/lib/validation/money";
import { ROLES } from "@/lib/types";

/**
 * Settings schemas.
 *
 * Forms submit strings (FormData has no vocabulary for integers or money), so
 * the numeric fields parse and bound-check here — the service receives typed,
 * validated values. Allocation and overpayment policies, reminder windows and
 * template bodies are stored on `systemSettings/{accountId}` (Decision F).
 */

// ---------------------------------------------------------------------------
// Billing rules
// ---------------------------------------------------------------------------

/**
 * `manual` allocation exists in the type but stays out of the form: it would
 * leave confirmed money sitting on payments with no review flow to resolve it
 * (Decision 12 keeps auto-credit until that flow exists).
 */
export const BILLING_ALLOCATION_STRATEGIES = ["oldest_first", "newest_first"] as const;

export const BILLING_OVERPAYMENT_OPTIONS = ["tenant_credit", "review"] as const;

const boundedInteger = (
  label: string,
  min: number,
  max: number,
) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} is required.` })
    .transform((value, ctx) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || String(parsed) !== value) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number.` });
        return z.NEVER;
      }
      if (parsed < min || parsed > max) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be between ${min} and ${max}.`,
        });
        return z.NEVER;
      }
      return parsed;
    });

export const billingRulesSchema = z
  .object({
    allocationStrategy: z.enum(BILLING_ALLOCATION_STRATEGIES, {
      message: "Choose an allocation order.",
    }),
    overpayment: z.enum(BILLING_OVERPAYMENT_OPTIONS, {
      message: "Choose an overpayment policy.",
    }),
    lateFeeEnabled: z.boolean(),
    /** KES amount entered by the user; parsed into minor units at the edge. */
    lateFeeAmount: moneyMinorOrZero,
    gracePeriodDays: boundedInteger("Grace period", 0, 60),
    invoiceGenerationDay: boundedInteger("Invoice generation day", 1, 28),
  })
  .refine(
    (rules) => !rules.lateFeeEnabled || rules.lateFeeAmount > 0,
    { message: "Enter the late fee amount.", path: ["lateFeeAmount"] },
  );

export type BillingRulesInput = {
  allocationStrategy: (typeof BILLING_ALLOCATION_STRATEGIES)[number];
  overpayment: (typeof BILLING_OVERPAYMENT_OPTIONS)[number];
  lateFeeEnabled: boolean;
  lateFeeAmount: number;
  gracePeriodDays: number;
  invoiceGenerationDay: number;
};

// ---------------------------------------------------------------------------
// Reminder rules
// ---------------------------------------------------------------------------

export const reminderRulesSchema = z.object({
  dueSoonDaysBefore: boundedInteger("Due-soon window", 0, 14),
  overdueRepeatDays: boundedInteger("Arrears repeat interval", 1, 30),
});

export type ReminderRulesInput = {
  dueSoonDaysBefore: number;
  overdueRepeatDays: number;
};

// ---------------------------------------------------------------------------
// SMS templates
// ---------------------------------------------------------------------------

/**
 * Only the templates an existing flow sends are editable. `lease_expiry` and
 * `bulk_announcement` stay out until their trigger flows ship (Phase 6
 * shipped the three below; see docs/DECISIONS.md).
 */
export const EDITABLE_SMS_TEMPLATE_KEYS = [
  "payment_receipt",
  "rent_due_reminder",
  "arrears_notice",
] as const;

export const smsTemplateSchema = z.object({
  key: z.enum(EDITABLE_SMS_TEMPLATE_KEYS),
  body: z
    .string()
    .trim()
    .min(10, { message: "Keep the message at least 10 characters." })
    .max(480, { message: "Keep the message under 480 characters." }),
  enabled: z.boolean(),
});

export const smsTemplatesSchema = z
  .array(smsTemplateSchema)
  .max(EDITABLE_SMS_TEMPLATE_KEYS.length)
  .refine(
    (templates) => {
      const keys = new Set(templates.map((template) => template.key));
      return EDITABLE_SMS_TEMPLATE_KEYS.every((key) => keys.has(key));
    },
    { message: "Every template needs a body." },
  );

export type SmsTemplateInput = z.infer<typeof smsTemplateSchema>;

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: "Enter the staff member's full name." })
  .max(120, { message: "Keep this under 120 characters." });

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, { message: "Keep this under 200 characters." })
  .pipe(z.email({ message: "Enter a valid email address." }));

export const staffInviteSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  role: z.enum(ROLES, { message: "Choose a role." }),
  /** Kenyan mobile in E.164 (`+2547…`), verified by the service. */
  phoneE164: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Empty for admins; property scope for every other role. */
  propertyIds: z
    .array(z.string().min(1))
    .max(100, { message: "Too many properties assigned." })
    .default([]),
});

export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffRoleScopeSchema = z.object({
  role: z.enum(ROLES, { message: "Choose a role." }),
  propertyIds: z
    .array(z.string().min(1))
    .max(100, { message: "Too many properties assigned." })
    .default([]),
});

export type StaffRoleScopeInput = z.infer<typeof staffRoleScopeSchema>;
