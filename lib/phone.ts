/**
 * Kenyan phone normalisation.
 *
 * Accepted inputs: 0712 345 678, 712345678, 254712345678, +254712345678,
 * with spaces, dashes or parentheses. Output is always E.164 (+2547XXXXXXXX).
 */

export const KENYA_COUNTRY_CODE = "254";
const MOBILE_NATIONAL = /^[17]\d{8}$/; // Safaricom/Airtel/Telkom mobile ranges start 7 or 1
const E164_KENYA = /^\+254[17]\d{8}$/;

export function normaliseKenyanPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");

  if (!digits) return null;

  let national: string;

  if (digits.startsWith("+254")) {
    national = digits.slice(4);
  } else if (digits.startsWith("254")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // Strip a leading 0 that survived e.g. 2540712...
  if (national.startsWith("0")) {
    national = national.slice(1);
  }

  if (!MOBILE_NATIONAL.test(national)) return null;

  return `+${KENYA_COUNTRY_CODE}${national}`;
}

export function isValidKenyanPhone(input: string): boolean {
  return normaliseKenyanPhone(input) !== null;
}

export function isE164Kenyan(input: string): boolean {
  return E164_KENYA.test(input);
}

/** Display format: +254 712 345 678 */
export function formatKenyanPhone(e164: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return match ? `+254 ${match[1]} ${match[2]} ${match[3]}` : e164;
}
