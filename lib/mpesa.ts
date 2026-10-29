/**
 * M-Pesa (Daraja) callback parsing.
 *
 * Pure functions only: no Firestore, no network, no Node-only APIs beyond
 * `Buffer` for the STK password helper, which the tests exercise directly.
 *
 * Safaricom callbacks arrive as loosely typed JSON with every value as a
 * string, so each field is parsed defensively. An unparseable field is an
 * error, never a zero-value receipt — money that cannot be read must not be
 * recorded.
 */

import { normaliseKenyanPhone } from "@/lib/phone";
import { MAX_AMOUNT_MINOR } from "@/lib/validation/money";

/** "TransTime" is `YYMMDDHHmmss` in Africa/Nairobi (UTC+3), all year. */
export const MPESA_TRANS_TIME_LENGTH = 12;

/** Short codes are 5 to 12 digits (Paybill, Buy Goods or Merchant Code). */
export const MPESA_SHORTCODE_PATTERN = /^\d{5,12}$/;

/** A C2B transaction id, e.g. `RKT7DMQ6K8`, or an STK `QK`-prefixed receipt. */
export const MPESA_RECEIPT_PATTERN = /^[A-Z0-9]{8,15}$/;

/** Parameter names Daraja sends inside `Body.stkCallback.CallbackMetadata.Item`. */
export type MpesaMetadataName =
  | "Amount"
  | "Balance"
  | "PhoneNumber"
  | "MpesaReceiptNumber"
  | "TransactionDate";

/**
 * Parse "1000.00" into KES cents. Rejects thousand separators (Daraja never
 * sends them; "1,000.00" is considered corrupt), extra decimals and absurd
 * totals — the same max as form amounts.
 */
export function parseMpesaAmount(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;

  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;

  const [whole = "", fraction = ""] = value.split(".");
  const fractionValue = fraction === "" ? 0 : Number(`0.${fraction}`);
  if (!Number.isFinite(fractionValue)) return null;

  const minor = Math.round((Number(whole) + fractionValue) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  if (minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Format minor units as Daraja expects them, e.g. `15000.50` or `15000`. */
export function formatMpesaAmount(minor: number): string {
  const value = minor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Parse the transaction timestamp. Two lengths arrive in the wild: 12 digits
 * (`YYMMDDHHmmss`) and 14 (`YYYYMMDDHHmmss`). Daraja sends Kenyan wall-clock
 * time, which is UTC+3 permanently, so the `Date` is derived arithmetically —
 * no timezone database required.
 */
export function parseMpesaTransTime(raw: string): Date | null {
  const value = raw.trim();
  if (!/^\d{12}$|^\d{14}$/.test(value)) return null;

  const norm = value.length === 12 ? `20${value}` : value;

  const year = Number(norm.slice(0, 4));
  const month = Number(norm.slice(4, 6));
  const day = Number(norm.slice(6, 8));
  const hour = Number(norm.slice(8, 10));
  const minute = Number(norm.slice(10, 12));
  const second = Number(norm.slice(12, 14));

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Timestamps stored in UTC represent the same Nairobi instant.
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - 3 * 60 * 60 * 1000);
}

/** Parse an STK `TransactionDate` — the same `YYMMDDHHmmss` wall clock. */
export function parseMpesaTransactionDate(raw: string): Date | null {
  return parseMpesaTransTime(raw);
}

/** Dot-joined payer name; empty parts are dropped, e.g. `Jane Wanjiku`. */
export function payerNameFromC2B(parts: {
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}): string | undefined {
  const name = [parts.FirstName, parts.MiddleName, parts.LastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return name || undefined;
}

/**
 * Daraja sends the payer MSISDN without a leading zero or plus, e.g.
 * `254712345678`. Normalise it into the E.164 shape the phone index uses.
 */
export function normaliseMsisdn(raw: string): string | null {
  return normaliseKenyanPhone(raw);
}

/** One STK callback metadata item: `{ Name, Value }`. */
export interface MpesaMetadataItem {
  Name: MpesaMetadataName | string;
  Value: string | number;
}

function readMetadataItem(
  items: MpesaMetadataItem[] | undefined,
  name: MpesaMetadataName,
): MpesaMetadataItem | undefined {
  return items?.find((item) => item.Name === name);
}

export interface StkSuccessFacts {
  amountMinor: number;
  receiptNumber: string;
  payerPhone: string | null;
  transactionDate: Date | null;
}

/**
 * Extract the payment facts from a successful STK callback. Result codes other
 * than `0` and their `ResultDesc` are handled by the caller, which keeps
 * records on the matching prompt-free request document instead of money.
 */
export function stkSuccessFacts(
  metadata: MpesaMetadataItem[] | undefined,
  receivedAtFallback: Date,
): StkSuccessFacts | null {
  const amountItem = readMetadataItem(metadata, "Amount");
  const receiptItem = readMetadataItem(metadata, "MpesaReceiptNumber");
  if (!amountItem || !receiptItem) return null;

  const amountMinor = parseMpesaAmount(String(amountItem.Value));
  if (amountMinor === null) return null;

  const receipt = String(receiptItem.Value).trim().toUpperCase();
  if (!MPESA_RECEIPT_PATTERN.test(receipt)) return null;

  const phoneItem = readMetadataItem(metadata, "PhoneNumber");
  const dateItem = readMetadataItem(metadata, "TransactionDate");
  const date = dateItem ? parseMpesaTransactionDate(String(dateItem.Value)) : null;

  return {
    amountMinor,
    receiptNumber: receipt,
    payerPhone: phoneItem ? normaliseMsisdn(String(phoneItem.Value)) : null,
    transactionDate: date ?? receivedAtFallback,
  };
}

/**
 * STK push password: base64 of `Shortcode + Passkey + Timestamp`. The passkey
 * also validates the callback route timestamps stay within Daraja's window.
 */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/** `YYYYMMDDHHmmss` in Nairobi time, the 14-digit form Daraja requires. */
export function mpesaRequestIdTimestamp(date: Date): string {
  const nairobi = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return (
    `${pad(nairobi.getUTCFullYear(), 4)}${pad(nairobi.getUTCMonth() + 1)}${pad(nairobi.getUTCDate())}` +
    `${pad(nairobi.getUTCHours())}${pad(nairobi.getUTCMinutes())}${pad(nairobi.getUTCSeconds())}`
  );
}

/**
 * `AccountReference` must be alphanumeric, at most 12 characters for M-Pesa
 * onboarding rules, and is what the tenant sees on their phone prompt.
 */
export function stkAccountReference(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return cleaned || "RENT";
}

/** Timing-safe webhook secret comparison for the callback routes. */
export function callbackSecretMatches(
  expected: string | undefined,
  provided: string | undefined,
): boolean {
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}
