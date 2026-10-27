/**
 * Billing calendar and invoice arithmetic.
 *
 * The business calendar is Africa/Nairobi. Periods are `YYYY-MM`, invoice ids
 * are deterministic (`{leaseId}_{periodKey}`), and money stays in integer minor
 * units. Proration uses whole calendar days and rounds to the nearest cent.
 */

import { parseDateInput, toDateInput } from "@/lib/dates";
import type { InvoiceStatus, MinorUnits } from "@/lib/types";

const PERIOD_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERIOD_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

export interface PeriodBounds {
  /** Midnight Nairobi on the first day. */
  start: Date;
  /** Midnight Nairobi on the last day. */
  end: Date;
  daysInMonth: number;
  label: string;
}

export function isPeriodKey(value: string): boolean {
  return PERIOD_KEY.test(value.trim());
}

/** Parse `YYYY-MM`; returns null for anything else. */
export function parsePeriodKey(
  value: string,
): { year: number; month: number } | null {
  const match = PERIOD_KEY.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** `YYYY-MM` for an instant, using the Nairobi calendar. */
export function periodKeyFor(value: Date): string {
  return toDateInput(value).slice(0, 7);
}

export function currentPeriodKey(now: Date = new Date()): string {
  return periodKeyFor(now);
}

/** Newest-first period keys, e.g. `["2026-10", "2026-09", …]`. */
export function recentPeriodKeys(
  count = 12,
  now: Date = new Date(),
): string[] {
  const parsed = parsePeriodKey(currentPeriodKey(now));
  if (!parsed) return [];
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const total = parsed.year * 12 + (parsed.month - 1) - index;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return keys;
}

/** Inclusive month bounds and the number of days to bill. */
export function periodBounds(periodKey: string): PeriodBounds | null {
  const parsed = parsePeriodKey(periodKey);
  if (!parsed) return null;

  const daysInMonth = new Date(
    Date.UTC(parsed.year, parsed.month, 0),
  ).getUTCDate();
  const start = parseDateInput(`${periodKey}-01`);
  const end = parseDateInput(
    `${periodKey}-${String(daysInMonth).padStart(2, "0")}`,
  );
  if (!start || !end) return null;

  return {
    start,
    end,
    daysInMonth,
    label: PERIOD_LABEL.format(start),
  };
}

/** Display label, falling back to the raw key for bad input. */
export function periodLabel(periodKey: string): string {
  return periodBounds(periodKey)?.label ?? periodKey;
}

/** Deterministic id — one invoice per lease and period. */
export function invoiceIdFor(leaseId: string, periodKey: string): string {
  return `${leaseId}_${periodKey}`;
}

function dayNumber(value: Date): number {
  const iso = toDateInput(value);
  const date = new Date(`${iso}T00:00:00Z`);
  return Math.round(date.getTime() / 86_400_000);
}

/**
 * Billable days where the lease overlaps the period (inclusive on both ends).
 * A lease that starts mid-month or ends mid-month is prorated.
 */
export function coveredDays(
  leaseStart: Date,
  leaseEnd: Date,
  bounds: PeriodBounds,
): number {
  const start = Math.max(dayNumber(leaseStart), dayNumber(bounds.start));
  const end = Math.min(dayNumber(leaseEnd), dayNumber(bounds.end));
  if (end < start) return 0;
  return end - start + 1;
}

/** Pro-rata rent for the covered days, rounded to the nearest cent. */
export function proratedRent(
  rentAmountMinor: MinorUnits,
  billableDays: number,
  daysInMonth: number,
): MinorUnits {
  if (daysInMonth <= 0) return 0;
  if (billableDays <= 0) return 0;
  if (billableDays >= daysInMonth) return rentAmountMinor;
  return Math.round((rentAmountMinor * billableDays) / daysInMonth);
}

/** Nairobi midnight on the lease due day inside this period. */
export function dueDateForPeriod(
  periodKey: string,
  dueDay: number,
): Date | null {
  const bounds = periodBounds(periodKey);
  if (!bounds) return null;
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), bounds.daysInMonth);
  return parseDateInput(`${periodKey}-${String(day).padStart(2, "0")}`);
}

/**
 * Stored statuses are `open`, `partial`, `paid` and `void`; `overdue` is derived
 * from the due date so it can never go stale. The scheduled job may persist it
 * later without changing this contract.
 */
export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: Date | string,
  today: string = toDateInput(new Date()),
): InvoiceStatus {
  if (status !== "open" && status !== "partial") return status;
  const due = toDateInput(dueDate);
  return due !== "" && due < today ? "overdue" : status;
}

/** Stored status implied by an invoice's balance after an allocation. */
export function statusForBalance(
  amountDueMinor: MinorUnits,
  amountPaidMinor: MinorUnits,
): InvoiceStatus {
  if (amountPaidMinor <= 0) return "open";
  if (amountPaidMinor >= amountDueMinor) return "paid";
  return "partial";
}
