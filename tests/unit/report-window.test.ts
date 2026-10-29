import { describe, expect, it } from "vitest";

import { monthBounds, nairobiMonthKey } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { parseReportWindow } from "@/services/reports";

describe("nairobiMonthKey", () => {
  it("buckets an instant by the Nairobi calendar month", () => {
    // 2026-10-31T21:00Z is 2026-11-01 at midnight Nairobi.
    expect(nairobiMonthKey(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11");
    expect(nairobiMonthKey(new Date("2026-10-31T20:59:00Z"))).toBe("2026-10");
    // Millisecond input works for Firestore Timestamp conversions.
    expect(nairobiMonthKey(new Date("2026-01-15T10:00:00Z").getTime())).toBe(
      "2026-01",
    );
  });
});

describe("monthBounds", () => {
  it("gives fixed-offset month edges and the next key", () => {
    const bounds = monthBounds("2026-10");
    expect(bounds.start.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(bounds.nextKey).toBe("2026-11");
  });

  it("rolls the year over in December", () => {
    const bounds = monthBounds("2025-12");
    expect(bounds.nextKey).toBe("2026-01");
    expect(bounds.end.toISOString()).toBe("2025-12-31T21:00:00.000Z");
  });

  it("rejects junk keys", () => {
    expect(() => monthBounds("2026-13")).toThrow();
    expect(() => monthBounds("oct")).toThrow();
  });
});

describe("parseReportWindow", () => {
  it("defaults to the trailing 90 days inclusive of today", () => {
    const window = parseReportWindow();
    const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
    expect(days).toBe(90);
  });

  it("makes the `to` day inclusive by ending after its midnight", () => {
    const window = parseReportWindow("2026-10-01", "2026-10-31");
    expect(window.from.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    // Midnight Nairobi of Nov 1 = exclusive window end.
    expect(window.to.toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });

  it("rejects bad or inverted ranges", () => {
    expect(() => parseReportWindow("31/10/2026", "2026-10-31")).toThrow(
      ServiceError,
    );
    expect(() => parseReportWindow("2026-02-30", "2026-03-02")).toThrow(
      ServiceError,
    );
    expect(() => parseReportWindow("2026-10-10", "2026-10-01")).toThrow(
      ServiceError,
    );
    // A single-day window is legitimate, not inverted.
    const oneDay = parseReportWindow("2026-10-05", "2026-10-05");
    expect((oneDay.to.getTime() - oneDay.from.getTime()) / 86_400_000).toBe(1);
  });
});
