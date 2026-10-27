import { z } from "zod";

import { parseDateInput } from "@/lib/dates";
import { moneyMinor, moneyMinorOrZero } from "@/lib/validation/money";

const dateInput = z.string().trim().transform((value, ctx) => {
  const date = parseDateInput(value);
  if (!date) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a valid date.",
    });
    return z.NEVER;
  }
  return date;
});

const dueDay = z.coerce
  .number()
  .int()
  .min(1, { message: "Due day must be between 1 and 28." })
  .max(28, { message: "Due day must be between 1 and 28." });

export const leaseCreateSchema = z
  .object({
    tenantId: z.string().trim().min(1, { message: "Choose a tenant." }),
    unitId: z.string().trim().min(1, { message: "Choose a unit." }),
    startDate: dateInput,
    endDate: dateInput,
    rentAmount: moneyMinor,
    depositAmount: moneyMinorOrZero,
    dueDay,
  })
  .refine((value) => value.endDate.getTime() > value.startDate.getTime(), {
    path: ["endDate"],
    message: "The end date must be after the start date.",
  });

export type LeaseCreateInput = z.infer<typeof leaseCreateSchema>;

/** Rent, deposit and due day may change mid-lease with a written reason.
 *  The change is audited and only affects invoices generated afterwards. */
export const leaseTermsSchema = z.object({
  rentAmount: moneyMinor,
  depositAmount: moneyMinorOrZero,
  dueDay,
  reason: z
    .string()
    .trim()
    .min(5, { message: "Explain why the terms are changing." })
    .max(500, { message: "Keep this under 500 characters." }),
});

export type LeaseTermsInput = z.infer<typeof leaseTermsSchema>;

export const leaseTerminateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500),
  endDate: dateInput.optional(),
});

export type LeaseTerminateInput = z.infer<typeof leaseTerminateSchema>;

export const leaseRenewSchema = z
  .object({
    startDate: dateInput,
    endDate: dateInput,
    rentAmount: moneyMinor,
    dueDay,
    reason: z
      .string()
      .trim()
      .min(5, { message: "Give a short reason (at least 5 characters)." })
      .max(500),
  })
  .refine((value) => value.endDate.getTime() > value.startDate.getTime(), {
    path: ["endDate"],
    message: "The end date must be after the start date.",
  });

export type LeaseRenewInput = z.infer<typeof leaseRenewSchema>;
