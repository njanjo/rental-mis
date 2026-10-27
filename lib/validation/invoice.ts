import { z } from "zod";

import { isPeriodKey } from "@/lib/billing";

const period = z
  .string()
  .trim()
  .refine((value) => isPeriodKey(value), {
    message: "Choose a billing month.",
  });

export const invoiceGenerateSchema = z.object({
  period: period,
});

export type InvoiceGenerateInput = z.infer<typeof invoiceGenerateSchema>;

export const invoiceVoidSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a reason of at least 5 characters." })
    .max(500, { message: "Keep the reason under 500 characters." }),
});

export type InvoiceVoidInput = z.infer<typeof invoiceVoidSchema>;
