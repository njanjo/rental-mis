import { z } from "zod";

import { normaliseKenyanPhone } from "@/lib/phone";
import { TENANT_STATUSES } from "@/lib/types";

const name = z
  .string()
  .trim()
  .min(2, { message: "Enter the tenant's full name." })
  .max(120, { message: "Keep this under 120 characters." });

export const phoneSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter a phone number." })
  .transform((value, ctx) => {
    const normalised = normaliseKenyanPhone(value);
    if (!normalised) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a Kenyan mobile number, e.g. 0712 345 678.",
      });
      return z.NEVER;
    }
    return normalised;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Keep this under ${max} characters.` })
    .optional()
    .transform((value) => (value ? value : undefined));

export const tenantSchema = z.object({
  fullName: name,
  phone: phoneSchema,
  nationalIdLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, { message: "Enter the last 4 digits only." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status: z.enum(TENANT_STATUSES, { message: "Choose a tenant status." }),
  consentSms: z.boolean().default(true),
  notes: optionalText(1000),
});

export type TenantInput = z.infer<typeof tenantSchema>;

export const tenantUpdateSchema = tenantSchema;

/** Marking a tenant as former is a status change, not a delete. */
export const tenantStatusSchema = z.object({
  status: z.enum(TENANT_STATUSES),
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500)
    .optional(),
});

export type TenantStatusInput = z.infer<typeof tenantStatusSchema>;
