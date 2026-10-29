/**
 * Payment identity helpers.
 *
 * The normalisation rules live in `lib/payment-reference.ts` (no Node imports,
 * safe for tests and future client-side previews). This module adds the
 * deterministic document id, which needs a hash.
 */

import { createHash } from "node:crypto";

import { paymentReferenceKey } from "@/lib/payment-reference";
import type { PaymentProvider } from "@/lib/types";

export {
  normalisePaymentReference,
  paymentReferenceKey,
  referenceOptional,
  REFERENCE_REQUIRED_PROVIDERS,
} from "@/lib/payment-reference";

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
