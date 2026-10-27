import { z } from "zod";

import type { MinorUnits } from "@/lib/types";

/**
 * KES 10,000,000 — a typo guard for rent fields, not a business limit.
 * Anything above this is almost certainly a data-entry slip.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

const MONEY_PATTERN = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/** Parse user-entered KES ("15,000.50") into integer minor units. */
export function parseMoneyInput(input: string): MinorUnits | null {
  const value = input.trim();
  if (!value || !MONEY_PATTERN.test(value)) return null;

  const numeric = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;

  const minor = Math.round(numeric * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  return minor;
}

/** Format minor units for a form input, e.g. 1500050 -> "15,000.50". */
export function moneyInputValue(minor: MinorUnits | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  return (minor / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
}

function moneySchema(options: { allowZero: boolean; label: string }) {
  return z
    .string()
    .trim()
    .min(1, { message: `${options.label} is required.` })
    .transform((value, ctx) => {
      const minor = parseMoneyInput(value);
      if (minor === null) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid amount, e.g. 15,000.00",
        });
        return z.NEVER;
      }
      return minor;
    })
    .pipe(
      z
        .number()
        .int()
        .max(MAX_AMOUNT_MINOR, "Amount looks too large. Check the figure.")
        .refine((value) => (options.allowZero ? value >= 0 : value > 0), {
          message: options.allowZero
            ? "Amount cannot be negative."
            : "Amount must be greater than zero.",
        }),
    );
}

/** Required positive amount, parsed to integer minor units. */
export const moneyMinor = moneySchema({ allowZero: false, label: "Amount" });

/** Deposit-style amount where zero is meaningful. */
export const moneyMinorOrZero = moneySchema({ allowZero: true, label: "Amount" });
