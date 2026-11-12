import { describe, expect, it } from "vitest";

import type { Capability } from "@/lib/auth/permissions";
import {
  METRIC_BASES,
  METRIC_IDS,
  METRICS,
  METRIC_UNITS,
  change,
  collectionRate,
  getMetric,
  ratio,
  type MetricId,
} from "@/lib/metrics/catalog";

describe("metric catalog", () => {
  it("defines exactly one complete definition per metric id", () => {
    expect(Object.keys(METRICS)).toHaveLength(METRIC_IDS.length);

    for (const id of METRIC_IDS) {
      const definition = getMetric(id);
      expect(definition.id).toBe(id);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.formula.length).toBeGreaterThan(0);
      expect(METRIC_BASES).toContain(definition.basis);
      expect(METRIC_UNITS).toContain(definition.unit);
      expect(definition.capability).toBe<Capability>("view_financials");
    }
  });

  it("uses unique, human labels and short labels within 18 characters", () => {
    const labels = METRIC_IDS.map((id) => METRICS[id].label);
    const shortLabels = METRIC_IDS.map((id) => METRICS[id].shortLabel);

    expect(new Set(labels).size).toBe(METRIC_IDS.length);
    expect(new Set(shortLabels).size).toBe(METRIC_IDS.length);
    for (const shortLabel of shortLabels) {
      expect(shortLabel.length).toBeLessThanOrEqual(18);
      expect(shortLabel.length).toBeGreaterThan(0);
    }
  });

  it("keeps rate metrics on a percent unit and money metrics on minor units", () => {
    for (const id of [
      "collection_rate",
      "arrears_rate",
      "occupancy",
      "reversal_rate",
    ] as const) {
      expect(METRICS[id].unit).toBe("percent");
    }
    for (const id of [
      "collected",
      "billed",
      "outstanding_arrears",
      "unmatched_value",
      "average_rent",
    ] as const) {
      expect(METRICS[id].unit).toBe("money");
    }
  });

  it("throws a clear error for an unknown metric id", () => {
    const unknown = "not_a_metric" as unknown as MetricId;
    expect(() => getMetric(unknown)).toThrow(/Unknown metric "not_a_metric"/);
  });
});

describe("ratio", () => {
  it("returns a 0..1 fraction for a positive denominator", () => {
    expect(ratio(4_500_000, 5_000_000)).toBe(0.9);
    expect(ratio(0, 5_000_000)).toBe(0);
  });

  it("returns null when the denominator is zero", () => {
    expect(ratio(1_000, 0)).toBeNull();
  });

  it("returns null for a negative denominator", () => {
    expect(ratio(1_000, -5)).toBeNull();
  });

  it("returns null when either input is not finite", () => {
    expect(ratio(Number.NaN, 100)).toBeNull();
    expect(ratio(100, Number.POSITIVE_INFINITY)).toBeNull();
    expect(ratio(Number.NEGATIVE_INFINITY, 100)).toBeNull();
  });
});

describe("collectionRate", () => {
  it("divides collected by billed on the billing-period basis", () => {
    const result = collectionRate({
      collectedMinor: 4_500_000,
      billedMinor: 5_000_000,
    });

    expect(result.rate).toBe(0.9);
    expect(result.basis).toBe("billing-period");
    expect(result.numeratorMinor).toBe(4_500_000);
    expect(result.denominatorMinor).toBe(5_000_000);
  });

  it("returns a null rate when nothing was billed", () => {
    const result = collectionRate({
      collectedMinor: 250_000,
      billedMinor: 0,
    });

    expect(result.rate).toBeNull();
    expect(result.basis).toBe("billing-period");
    expect(result.denominatorMinor).toBe(0);
  });

  it("never returns NaN or Infinity for non-finite inputs", () => {
    const result = collectionRate({
      collectedMinor: Number.NaN,
      billedMinor: Number.POSITIVE_INFINITY,
    });

    expect(result.rate).toBeNull();
    expect(Number.isFinite(result.numeratorMinor)).toBe(true);
    expect(Number.isFinite(result.denominatorMinor)).toBe(true);
  });
});

describe("change", () => {
  it("marks a rise as good when higher is better", () => {
    const result = change(120_000, 100_000, { higherIsBetter: true });

    expect(result.delta).toBe(20_000);
    expect(result.direction).toBe("up");
    expect(result.percent).toBeCloseTo(0.2);
    expect(result.good).toBe(true);
  });

  it("marks a rise as bad when lower is better", () => {
    const result = change(120_000, 100_000, { higherIsBetter: false });

    expect(result.direction).toBe("up");
    expect(result.good).toBe(false);
  });

  it("reports a fall as down and good when lower is better", () => {
    const result = change(80_000, 100_000, { higherIsBetter: false });

    expect(result.delta).toBe(-20_000);
    expect(result.direction).toBe("down");
    expect(result.percent).toBeCloseTo(-0.2);
    expect(result.good).toBe(true);
  });

  it("treats an exact zero delta as flat with no good/bad verdict", () => {
    const result = change(75_000, 75_000, { higherIsBetter: true });

    expect(result.delta).toBe(0);
    expect(result.direction).toBe("flat");
    expect(result.percent).toBe(0);
    expect(result.good).toBeNull();
  });

  it("leaves percent null when the previous value is zero", () => {
    const result = change(50_000, 0, { higherIsBetter: true });

    expect(result.direction).toBe("up");
    expect(result.percent).toBeNull();
    expect(result.good).toBe(true);
  });

  it("leaves percent null for a flat zero-to-zero comparison", () => {
    const result = change(0, 0, { higherIsBetter: true });

    expect(result.direction).toBe("flat");
    expect(result.percent).toBeNull();
    expect(result.good).toBeNull();
  });

  it("measures percent against the absolute previous value", () => {
    const result = change(50, -100, { higherIsBetter: true });

    expect(result.delta).toBe(150);
    expect(result.percent).toBe(1.5);
    expect(result.good).toBe(true);
  });

  it("returns a neutral flat result for non-finite inputs", () => {
    for (const [current, previous] of [
      [Number.NaN, 100],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 100],
      [100, Number.NEGATIVE_INFINITY],
    ] as const) {
      const result = change(current, previous, { higherIsBetter: true });
      expect(result).toEqual({
        delta: 0,
        direction: "flat",
        percent: null,
        good: null,
      });
    }
  });
});
