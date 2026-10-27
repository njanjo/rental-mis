import { z } from "zod";

import { parseDateInput } from "@/lib/dates";
import { normaliseKenyanPhone } from "@/lib/phone";
import { PAYMENT_PROVIDERS } from "@/lib/types";
import { moneyMinor } from "@/lib/validation/money";

const dateInput = z.string().trim().transform((value, ctx) => {
  const date = parseDateInput(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: "Enter a valid receipt date." });
    return z.NEVER;
  }
  return date;
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { message })
    .optional()
    .transform((value) => value?.trim() || undefined)
    // Keep the inferred field optional so callers can omit blank form fields.
    .optional();

const optionalPhone = z
  .string()
  .trim()
  .max(24)
  .optional()
  .transform((value, ctx) => {
    const raw = value?.trim() ?? "";
    if (!raw) return undefined;
    const phone = normaliseKenyanPhone(raw);
    if (!phone) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a Kenyan mobile number, e.g. 0712 345 678.",
      });
      return z.NEVER;
    }
    return phone;
  })
  .optional();

/** A receipt entered by finance after checking the M-Pesa or bank statement. */
export const manualReceiptSchema = z
  .object({
    tenantId: z.string().trim().min(1, { message: "Choose a tenant." }),
    amount: moneyMinor,
    provider: z.enum(PAYMENT_PROVIDERS),
    providerTransactionId: optionalText(
      80,
      "Keep the reference under 80 characters.",
    ),
    receivedAt: dateInput,
    payerName: optionalText(120, "Keep the payer name under 120 characters."),
    payerPhone: optionalPhone,
    narration: optionalText(500, "Keep the note under 500 characters."),
    bankCode: optionalText(20, "Keep the bank code under 20 characters."),
  })
  .superRefine((value, ctx) => {
    if (value.provider !== "manual" && !value.providerTransactionId) {
      ctx.addIssue({
        code: "custom",
        path: ["providerTransactionId"],
        message:
          value.provider === "mpesa"
            ? "Enter the M-Pesa transaction reference."
            : "Enter the bank transaction reference.",
      });
    }
  });

export type ManualReceiptInput = z.infer<typeof manualReceiptSchema>;

export const paymentReverseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a reason of at least 5 characters." })
    .max(500, { message: "Keep the reason under 500 characters." }),
});

export type PaymentReverseInput = z.infer<typeof paymentReverseSchema>;

export const unmatchedResolveSchema = z.object({
  tenantId: z.string().trim().min(1, { message: "Choose a tenant." }),
  note: optionalText(300, "Keep the note under 300 characters."),
});

export type UnmatchedResolveInput = z.infer<typeof unmatchedResolveSchema>;

export const unmatchedIgnoreSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a reason of at least 5 characters." })
    .max(500, { message: "Keep the reason under 500 characters." }),
});

export type UnmatchedIgnoreInput = z.infer<typeof unmatchedIgnoreSchema>;
