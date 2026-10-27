import type { MinorUnits } from "@/lib/types";

const KES = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const KES_COMPACT = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  notation: "compact",
  maximumFractionDigits: 1,
});

const DATE_SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Nairobi",
});

/** Format integer minor units (KES cents) as "KES 15,000.00". */
export function formatMoney(minor: MinorUnits): string {
  return KES.format((minor ?? 0) / 100);
}

/** Compact variant for KPI cards, e.g. "KES 1.2M". */
export function formatMoneyCompact(minor: MinorUnits): string {
  return KES_COMPACT.format((minor ?? 0) / 100);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const maybe = value as { toDate: () => Date };
    return maybe.toDate();
  }
  return null;
}

export function formatDate(value: unknown): string {
  const date = toDate(value);
  return date ? DATE_SHORT.format(date) : "—";
}

export function formatDateTime(value: unknown): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return match ? `+254 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

/** Convert user-entered KES (e.g. "15,000.50") to integer minor units. */
export function parseMoneyToMinor(input: string): number | null {
  const cleaned = input.replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function minorToInput(minor: MinorUnits): string {
  return (minor / 100).toFixed(2);
}
