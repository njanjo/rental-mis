import { z } from "zod";

import { normaliseKenyanPhone } from "@/lib/phone";
import { moneyMinor } from "@/lib/validation/money";

/**
 * Daraja callback bodies. Everything arrives as loosely typed JSON with
 * inconsistent capitalisation between products, so the schemas stay
 * permissive (`.passthrough()`) and parsing lives in `lib/mpesa.ts`. Strict
 * validation of money happens after the payload is parsed, not against the
 * transport.
 */

/** C2B validation / confirmation callback (Registered URL API). */
export const mpesaC2bSchema = z
  .object({
    TransactionType: z.string().trim().min(1),
    TransID: z.string().trim().regex(/^[A-Z0-9]{8,15}$/),
    TransTime: z.string().trim().regex(/^\d{14}$/),
    TransAmount: z.string().trim().min(1),
    BusinessShortCode: z.union([z.string().optional(), z.number().optional()]),
    BillRefNumber: z.string().optional(),
    OrgAccountBalance: z.string().optional(),
    MSISDN: z.string().trim().regex(/^\d{10,15}$/),
    FirstName: z.string().optional(),
    MiddleName: z.string().optional(),
    LastName: z.string().optional(),
  })
  .passthrough();

/** `Body.stkCallback` inside the STK push callback. */
export const mpesaStkCallbackSchema = z
  .object({
    MerchantRequestID: z.string().trim().min(5),
    CheckoutRequestID: z.string().trim().min(6),
    ResultCode: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
    ResultDesc: z.string().trim().min(1),
    CallbackMetadata: z
      .object({
        Item: z.array(
          z.object({
            Name: z.string().trim().min(1),
            Value: z.union([z.string(), z.number()]),
          }),
        ),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Wrapper schema: Daraja sends `{ Body: { stkCallback: â€¦ } }`. */
export const mpesaStkBodySchema = z
  .object({ Body: z.object({ stkCallback: mpesaStkCallbackSchema }).passthrough() })
  .passthrough();


/**
 * Staff-requested STK prompt. The phone defaults to the tenant's own number but
 * may be overridden (e.g. a relative pays); the amount is KES parsed here so
 * the service layer only ever sees integer minor units.
 */
export const stkPushRequestSchema = z
  .object({
    tenantId: z
      .string()
      .trim()
      .min(1, { message: "Choose the tenant being billed." }),
    amount: moneyMinor,
    overridePhone: z
      .string()
      .transform((value, ctx) => {
        if (!value.trim()) return ""; // Empty means "use the tenant's phone".
        const e164 = normaliseKenyanPhone(value);
        if (!e164) {
          ctx.addIssue({
            code: "custom",
            message: "Enter a valid Kenyan phone number, e.g. 0712 345 678.",
          });
          return z.NEVER;
        }
        return e164;
      })
      .optional()
      .default(""),
    note: z.string().trim().max(200).optional(),
  })
  .passthrough();

export type StkPushRequestInput = z.infer<typeof stkPushRequestSchema>;

export interface RawMpesaC2bPayload {
  TransactionType: string;
  TransID: string;
  TransTime: string;
  TransAmount: string;
  MSISDN: string;
  BillRefNumber?: string;
  OrgAccountBalance?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
  BusinessShortCode?: string | number;
}

export interface RawMpesaStkCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: { Item: Array<{ Name: string; Value: string | number }> };
}

/** Parse the raw webhook body into the strongly typed shape or return null. */
export function parseC2bBody(body: unknown): RawMpesaC2bPayload | null {
  const parsed = mpesaC2bSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Parse a raw STK callback or return null when shaped unexpectedly. */
export function parseStkBody(body: unknown): RawMpesaStkCallback | null {
  const parsed = mpesaStkBodySchema.safeParse(body);
  if (!parsed.success) return null;

  const { stkCallback } = parsed.data.Body;
  return {
    ...stkCallback,
    ResultCode: typeof stkCallback.ResultCode === "string"
      ? Number(stkCallback.ResultCode)
      : stkCallback.ResultCode,
    CallbackMetadata: stkCallback.CallbackMetadata as RawMpesaStkCallback["CallbackMetadata"],
  };
}
