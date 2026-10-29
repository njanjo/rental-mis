/**
 * Payment reference helpers.
 *
 * Kept free of Node-only imports so server actions, the bank importer and tests
 * can share one normalisation rule. A reference is the idempotency key, so the
 * rule must be identical everywhere money is recorded.
 */

import type { PaymentProvider } from "@/lib/types";

/** Providers whose receipt always carries an external reference. */
export const REFERENCE_REQUIRED_PROVIDERS: PaymentProvider[] = ["mpesa", "bank"];

/**
 * Canonical form of a provider reference: trimmed, whitespace removed and
 * upper-cased. Punctuation is left alone so `A-1` and `A/1` stay distinct.
 */
export function normalisePaymentReference(reference: string): string {
  return reference.replace(/\s+/g, "").toUpperCase();
}

/** Namespaced key so the same code from two providers cannot collide. */
export function paymentReferenceKey(
  provider: PaymentProvider,
  reference: string,
): string {
  return `${provider}:${normalisePaymentReference(reference)}`;
}

/** True when a receipt may omit an external reference (cash entered by staff). */
export function referenceOptional(provider: PaymentProvider): boolean {
  return !REFERENCE_REQUIRED_PROVIDERS.includes(provider);
}
