/**
 * Date helpers. The business calendar is Africa/Nairobi (UTC+3, no DST), while
 * Firestore stores instants in UTC. Forms exchange `YYYY-MM-DD` strings.
 */

const NAIROBI_OFFSET = "+03:00";
const NAIROBI_TIMEZONE = "Africa/Nairobi";

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a `YYYY-MM-DD` form value as midnight in Nairobi. */
export function parseDateInput(value: string): Date | null {
  const match = DATE_INPUT.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00${NAIROBI_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;

  // Reject impossible calendar dates that JS would silently roll over.
  const roundTrip = toDateInput(date);
  return roundTrip === `${year}-${month}-${day}` ? date : null;
}

/** Format an instant as `YYYY-MM-DD` in Nairobi (safe for date inputs). */
export function toDateInput(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayIsoDate(): string {
  return toDateInput(new Date());
}

/** ISO instant for view models. Accepts Firestore Timestamps, Dates or strings. */
export function toIsoString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybe = value as { toDate: () => Date };
    const date = maybe.toDate();
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

/** Add months, clamping to the last day of the target month. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Midnight Nairobi on the `day` of the current month in Nairobi. */
export function dueDateForCurrentPeriod(day: number): Date {
  const today = todayIsoDate();
  const [year, month] = today.split("-");
  const clamped = Math.min(Math.max(day, 1), 28);
  return parseDateInput(
    `${year}-${month}-${String(clamped).padStart(2, "0")}`,
  ) as Date;
}
