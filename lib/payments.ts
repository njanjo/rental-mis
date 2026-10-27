/**
 * Payment identity helpers.
 *
 * Providers send references in several shapes (M-Pesa uses compact uppercase
 * codes, forms allow spaces, statements sometimes lower-case them). Normalising
 * here keeps idempotency deterministic. No Firestore or Node-only APIs live in
 * this module so it stays safe to import from tests.
 */

import { createHash } from "node:crypto";

import type { PaymentProvider } from "@/lib/types";

/** Providers whose receipt always carries an external reference. */
export const REFERENCE_REQUIRED_PROVIDERS: PaymentProvider[] = ["mpesa", "bank"];

/**
 * Canonical form of a provider reference for duplicate detection.
 *
 * References are case-insensitive and providers sometimes add spaces. The
 * displayed value keeps the original casing; only the lookup key is folded.
 */
export function normalisePaymentReference(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

/** Stable idempotency key for a provider transaction. */
export function paymentReferenceKey(
  provider: PaymentProvider,
  reference: string,
): string {
  return `${provider}:${normalisePaymentReference(reference)}`;
}

/**
 * Deterministic payment doc id from provider + reference.
 *
 * Two retries (or two staff entering the same receipt) resolve to the same
 * document, so the transaction check is a real idempotency guard rather than a
 * best-effort query. The hash keeps ids short and avoids leaking the reference
 * into a URL.
 */
export function paymentIdForReference(
  provider: PaymentProvider,
  reference: string,
): string {
  const key = paymentReferenceKey(provider, reference);
  return `pay_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/** True when a receipt may omit an external reference (cash entered by staff). */
export function referenceOptional(provider: PaymentProvider): boolean {
  return !REFERENCE_REQUIRED_PROVIDERS.includes(provider);
}
