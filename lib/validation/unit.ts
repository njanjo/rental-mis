import { z } from "zod";

import { UNIT_STATUSES } from "@/lib/types";
import { moneyMinor, moneyMinorOrZero } from "@/lib/validation/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Keep this under ${max} characters.` })
    .optional()
    .transform((value) => (value ? value : undefined));

export const unitSchema = z.object({
  propertyId: z.string().trim().min(1, { message: "Choose a property." }),
  unitNumber: z
    .string()
    .trim()
    .min(1, { message: "Enter a unit number." })
    .max(20, { message: "Keep this under 20 characters." })
    .transform((value) => value.toUpperCase()),
  rentAmount: moneyMinor,
  depositAmount: moneyMinorOrZero,
  status: z.enum(UNIT_STATUSES, { message: "Choose a unit status." }),
  notes: optionalText(500),
});

export type UnitInput = z.infer<typeof unitSchema>;

/** Editing keeps the unit number and property fixed — moving a unit would
 *  orphan its lease history. */
export const unitUpdateSchema = unitSchema.pick({
  rentAmount: true,
  depositAmount: true,
  status: true,
  notes: true,
});

export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>;

export const unitArchiveSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500),
});
