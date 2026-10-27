import { z } from "zod";

import { COUNTY_NAMES } from "@/lib/kenya";

const name = z
  .string()
  .trim()
  .min(2, { message: "Enter at least 2 characters." })
  .max(120, { message: "Keep this under 120 characters." });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Keep this under ${max} characters.` })
    .optional()
    .transform((value) => (value ? value : undefined));

export const propertySchema = z.object({
  name,
  address: z
    .string()
    .trim()
    .min(3, { message: "Enter the street address." })
    .max(240, { message: "Keep this under 240 characters." }),
  county: z.enum(COUNTY_NAMES, { message: "Choose a county." }),
  managerIds: z
    .array(z.string().min(1))
    .max(20, { message: "Too many managers assigned." })
    .default([]),
  notes: optionalText(1000),
});

export type PropertyInput = z.infer<typeof propertySchema>;

export const propertyArchiveSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500),
});

export type PropertyArchiveInput = z.infer<typeof propertyArchiveSchema>;
