import { describe, expect, it } from "vitest";

import {
  coveredDays,
  currentPeriodKey,
  dueDateForPeriod,
  effectiveInvoiceStatus,
  invoiceIdFor,
  isPeriodKey,
  periodBounds,
  periodKeyFor,
  periodLabel,
  proratedRent,
  recentPeriodKeys,
  statusForBalance,
} from "@/lib/billing";
import { parseDateInput, toDateInput } from "@/lib/dates";
import {
  invoiceGenerateSchema,
  invoiceVoidSchema,
} from "@/lib/validation/invoice";

function day(value: string): Date {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`bad date ${value}`);
  return parsed;
}

describe("billing periods", () => {
  it("parses and validates period keys", () => {
    expect(isPeriodKey("2026-01")).toBe(true);
    expect(isPeriodKey("2026-13")).toBe(false);
    expect(isPeriodKey("2026-1")).toBe(false);
    expect(isPeriodKey("2026-01-01")).toBe(false);
    expect(periodBounds("2026-13")).toBeNull();
  });

  it("computes inclusive month bounds and day counts", () => {
    const january = periodBounds("2026-01");
    expect(january?.daysInMonth).toBe(31);
    expect(toDateInput(january?.start)).toBe("2026-01-01");
    expect(toDateInput(january?.end)).toBe("2026-01-31");
    expect(january?.label).toBe("January 2026");

    expect(periodBounds("2024-02")?.daysInMonth).toBe(29);
    expect(periodBounds("2026-02")?.daysInMonth).toBe(28);
  });

  it("labels and keys periods in Nairobi", () => {
    expect(periodKeyFor(new Date("2026-01-31T21:30:00Z"))).toBe("2026-02");
    expect(periodKeyFor(new Date("2026-01-31T20:30:00Z"))).toBe("2026-01");
    expect(periodLabel("2026-11")).toBe("November 2026");
    expect(periodLabel("not-a-period")).toBe("not-a-period");
    expect(currentPeriodKey(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07");
  });

  it("builds deterministic invoice ids", () => {
    expect(invoiceIdFor("lease_1", "2026-01")).toBe("lease_1_2026-01");
  });

  it("lists recent periods newest first across year boundaries", () => {
    expect(recentPeriodKeys(3, new Date("2026-03-15T10:00:00+03:00"))).toEqual([
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
    expect(recentPeriodKeys(2, new Date("2026-01-15T10:00:00+03:00"))).toEqual([
      "2026-01",
      "2025-12",
    ]);
  });
});

describe("proration", () => {
  const march = periodBounds("2026-03")!;

  it("bills the whole month when the lease covers it", () => {
    expect(coveredDays(day("2025-01-01"), day("2026-12-31"), march)).toBe(31);
    expect(proratedRent(4_500_000, 31, 31)).toBe(4_500_000);
  });

  it("prorates a mid-month start", () => {
    const days = coveredDays(day("2026-03-11"), day("2026-12-31"), march);
    expect(days).toBe(21);
    expect(proratedRent(4_500_000, days, march.daysInMonth)).toBe(3_048_387);
  });

  it("prorates a mid-month end", () => {
    const days = coveredDays(day("2025-01-01"), day("2026-03-10"), march);
    expect(days).toBe(10);
    expect(proratedRent(4_500_000, days, march.daysInMonth)).toBe(1_451_613);
  });

  it("returns nothing when the lease does not overlap the period", () => {
    expect(coveredDays(day("2026-04-01"), day("2026-12-31"), march)).toBe(0);
    expect(coveredDays(day("2025-01-01"), day("2026-02-28"), march)).toBe(0);
    expect(proratedRent(4_500_000, 0, march.daysInMonth)).toBe(0);
    expect(proratedRent(4_500_000, 10, 0)).toBe(0);
  });
});

describe("due dates and status", () => {
  it("puts the due date on the lease due day inside the period", () => {
    expect(toDateInput(dueDateForPeriod("2026-03", 5))).toBe("2026-03-05");
    expect(toDateInput(dueDateForPeriod("2026-03", 1))).toBe("2026-03-01");
    expect(toDateInput(dueDateForPeriod("2026-03", 0))).toBe("2026-03-01");
  });

  it("clamps a due day past the end of the month", () => {
    expect(toDateInput(dueDateForPeriod("2026-02", 31))).toBe("2026-02-28");
    expect(toDateInput(dueDateForPeriod("2024-02", 30))).toBe("2024-02-29");
    expect(dueDateForPeriod("2026-13", 5)).toBeNull();
  });

  it("derives overdue without overwriting stored statuses", () => {
    const due = day("2026-03-05");
    expect(effectiveInvoiceStatus("open", due, "2026-03-05")).toBe("open");
    expect(effectiveInvoiceStatus("open", due, "2026-03-06")).toBe("overdue");
    expect(effectiveInvoiceStatus("partial", due, "2026-04-01")).toBe("overdue");
    expect(effectiveInvoiceStatus("paid", due, "2026-04-01")).toBe("paid");
    expect(effectiveInvoiceStatus("void", due, "2026-04-01")).toBe("void");
    expect(effectiveInvoiceStatus("open", "2026-03-05T00:00:00.000Z", "2026-03-06")).toBe(
      "overdue",
    );
  });

  it("maps a balance to a stored status", () => {
    expect(statusForBalance(4_500_000, 0)).toBe("open");
    expect(statusForBalance(4_500_000, 1_000_000)).toBe("partial");
    expect(statusForBalance(4_500_000, 4_500_000)).toBe("paid");
    expect(statusForBalance(4_500_000, 5_000_000)).toBe("paid");
  });
});

describe("invoice validation", () => {
  it("accepts only real billing months", () => {
    expect(invoiceGenerateSchema.safeParse({ period: "2026-08" }).success).toBe(true);
    expect(invoiceGenerateSchema.safeParse({ period: "2026-13" }).success).toBe(false);
    expect(invoiceGenerateSchema.safeParse({ period: "" }).success).toBe(false);
  });

  it("requires a meaningful void reason", () => {
    expect(invoiceVoidSchema.safeParse({ reason: "Duplicate invoice" }).success).toBe(
      true,
    );
    expect(invoiceVoidSchema.safeParse({ reason: "oops" }).success).toBe(false);
    expect(
      invoiceVoidSchema.safeParse({ reason: "x".repeat(501) }).success,
    ).toBe(false);
  });
});
