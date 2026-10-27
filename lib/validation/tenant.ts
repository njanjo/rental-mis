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

const nationalIdLast4 = z
  .string()
  .trim()
  .regex(/^\d{4}$/, { message: "Enter the last 4 digits only." })
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * New tenants are always created as active; status changes go through the
 * dedicated action so they can require a reason and respect active leases.
 */
export const tenantCreateSchema = z.object({
  propertyId: z.string().trim().min(1, { message: "Choose a property." }),
  fullName: name,
  phone: phoneSchema,
  nationalIdLast4,
  consentSms: z.boolean().default(true),
  notes: optionalText(1000),
});

export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;

/** Editing keeps the tenant on their property; leases move tenancy. */
export const tenantUpdateSchema = tenantCreateSchema.omit({ propertyId: true });

export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;

/** Marking a tenant as former is a status change, not a delete. */
export const tenantStatusSchema = z.object({
  status: z.enum(TENANT_STATUSES, { message: "Choose a tenant status." }),
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500),
});

export type TenantStatusInput = z.infer<typeof tenantStatusSchema>;
