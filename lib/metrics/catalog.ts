import type { Capability } from "@/lib/auth/permissions";

/**
 * Metric contract.
 *
 * A single definition per metric so dashboards, reports and CSV exports can
 * state the same meaning, formula and period basis. Money amounts are always
 * integer KES minor units; rates are stored as 0..1 fractions.
 *
 * This module is intentionally free of Firebase, React and server-only
 * imports so it can be shared with tests and client components.
 */

/** How a metric treats the selected reporting window. */
export const METRIC_BASES = [
  "cash-received",
  "billing-period",
  "as-of-now",
] as const;

export type MetricBasis = (typeof METRIC_BASES)[number];

/** How a metric's value should be rendered. */
export const METRIC_UNITS = ["money", "percent", "count", "days"] as const;

export type MetricUnit = (typeof METRIC_UNITS)[number];

/**
 * Stable metric identifiers. These are part of the reporting contract: add a
 * new id rather than renaming one so saved reports and CSV headers stay valid.
 */
export const METRIC_IDS = [
  "collected",
  "billed",
  "collection_rate",
  "outstanding_arrears",
  "arrears_rate",
  "occupancy",
  "vacant_units",
  "unmatched_value",
  "unmatched_count",
  "reversal_rate",
  "average_rent",
  "lease_expiries_60d",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export interface MetricDefinition {
  id: MetricId;
  label: string;
  shortLabel: string;
  description: string;
  formula: string;
  basis: MetricBasis;
  unit: MetricUnit;
  capability: Capability;
  higherIsBetter: boolean;
  caveat?: string;
}

/**
 * Every metric carries a capability even when the figure is operational, so
 * callers have one consistent guard. All current metrics are financial or
 * expose occupancy information, which is protected by `view_financials`.
 */
export const METRICS: Record<MetricId, MetricDefinition> = {
  collected: {
    id: "collected",
    label: "Collected",
    shortLabel: "Collected",
    description:
      "Net confirmed money received in the period, net of reversals.",
    formula:
      "sum(amountMinor) where status in confirmed|allocated|reversal and receivedAt in [from,to)",
    basis: "cash-received",
    unit: "money",
    capability: "view_financials",
    higherIsBetter: true,
    caveat:
      "Uses receivedAt, not the invoice period; unconfirmed M-Pesa is excluded.",
  },
  billed: {
    id: "billed",
    label: "Billed",
    shortLabel: "Billed",
    description: "Invoice value raised for the billing period.",
    formula:
      "sum(amountDueMinor) for non-void invoices where periodKey = labelled billing period",
    basis: "billing-period",
    unit: "money",
    capability: "view_financials",
    higherIsBetter: true,
    caveat:
      "Bucketed by invoice periodKey, so it does not share a period basis with collected.",
  },
  collection_rate: {
    id: "collection_rate",
    label: "Collection rate",
    shortLabel: "Collection rate",
    description: "Collected divided by billed for the same labelled period.",
    formula:
      "sum(cash received in period) / sum(invoice value for the same periodKey)",
    basis: "billing-period",
    unit: "percent",
    capability: "view_financials",
    higherIsBetter: true,
    caveat:
      "Never compare a cash-window numerator with a billing-period denominator.",
  },
  outstanding_arrears: {
    id: "outstanding_arrears",
    label: "Outstanding arrears",
    shortLabel: "Arrears",
    description: "Live unpaid invoice balances as of now.",
    formula:
      "sum(balanceMinor) where invoice status in open|partial|overdue",
    basis: "as-of-now",
    unit: "money",
    capability: "view_financials",
    higherIsBetter: false,
    caveat: "Ignores the selected reporting window.",
  },
  arrears_rate: {
    id: "arrears_rate",
    label: "Arrears rate",
    shortLabel: "Arrears rate",
    description:
      "Outstanding arrears divided by trailing 12-month billed value.",
    formula:
      "sum(balanceMinor where status in open|partial|overdue) / sum(amountDueMinor for the trailing 12 periodKeys)",
    basis: "as-of-now",
    unit: "percent",
    capability: "view_financials",
    higherIsBetter: false,
    caveat:
      "The numerator is live while the denominator is bucketed by periodKey.",
  },
  occupancy: {
    id: "occupancy",
    label: "Occupancy",
    shortLabel: "Occupancy",
    description: "Occupied active units divided by active units.",
    formula: "count(active units with status = occupied) / count(active units)",
    basis: "as-of-now",
    unit: "percent",
    capability: "view_financials",
    higherIsBetter: true,
  },
  vacant_units: {
    id: "vacant_units",
    label: "Vacant units",
    shortLabel: "Vacant units",
    description: "Active units not currently occupied.",
    formula: "count(active units where status != occupied)",
    basis: "as-of-now",
    unit: "count",
    capability: "view_financials",
    higherIsBetter: false,
    caveat: "Retired units are excluded from the active stock.",
  },
  unmatched_value: {
    id: "unmatched_value",
    label: "Unmatched value",
    shortLabel: "Unmatched value",
    description: "Money sitting in the unmatched review queue.",
    formula:
      "sum(payment.amountMinor) for unmatchedPayments where reviewStatus in pending|assigned",
    basis: "as-of-now",
    unit: "money",
    capability: "view_financials",
    higherIsBetter: false,
    caveat: "Not counted as collected.",
  },
  unmatched_count: {
    id: "unmatched_count",
    label: "Unmatched payments",
    shortLabel: "Unmatched count",
    description: "Payments awaiting matching in the review queue.",
    formula:
      "count(unmatchedPayments where reviewStatus in pending|assigned)",
    basis: "as-of-now",
    unit: "count",
    capability: "view_financials",
    higherIsBetter: false,
    caveat: "Scoped by the property of the linked payment.",
  },
  reversal_rate: {
    id: "reversal_rate",
    label: "Reversal rate",
    shortLabel: "Reversal rate",
    description:
      "Reversal value divided by gross confirmed value in the period.",
    formula:
      "abs(sum(amountMinor where status = reversal)) / sum(amountMinor where status = confirmed) over [from,to) by receivedAt",
    basis: "cash-received",
    unit: "percent",
    capability: "view_financials",
    higherIsBetter: false,
    caveat:
      "A reversal outside the window is not paired with its original receipt.",
  },
  average_rent: {
    id: "average_rent",
    label: "Average rent",
    shortLabel: "Average rent",
    description: "Mean contracted rent across active leases.",
    formula:
      "sum(lease.rentAmountMinor) / count(leases where status = active)",
    basis: "as-of-now",
    unit: "money",
    capability: "view_financials",
    higherIsBetter: true,
    caveat:
      "Contracted rent, not collected rent; prorated invoices are ignored.",
  },
  lease_expiries_60d: {
    id: "lease_expiries_60d",
    label: "Lease expiries (60 days)",
    shortLabel: "Expiries 60d",
    description: "Active leases ending in the next 60 days.",
    formula:
      "count(leases where status = active and endDate in [today, today + 60 days])",
    basis: "as-of-now",
    unit: "count",
    capability: "view_financials",
    higherIsBetter: false,
    caveat: "Expired or terminated leases are excluded.",
  },
};

/** Look up a definition, failing loudly for ids outside the contract. */
export function getMetric(id: MetricId): MetricDefinition {
  if (!Object.prototype.hasOwnProperty.call(METRICS, id)) {
    throw new Error(
      `Unknown metric "${String(id)}". Expected one of: ${METRIC_IDS.join(", ")}.`,
    );
  }
  return METRICS[id];
}

/**
 * Divide two amounts as a 0..1 fraction.
 *
 * Returns null when the denominator is non-positive or either input is not
 * finite. A zero or negative denominator has no meaningful rate, and a
 * non-finite value means the aggregate was incomplete; returning 0 would
 * silently misstate the result.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }
  return numerator / denominator;
}

export interface CollectionRateResult {
  /** Fraction 0..1, or null when billed value is non-positive/unknown. */
  rate: number | null;
  basis: MetricBasis;
  numeratorMinor: number;
  denominatorMinor: number;
}

/**
 * Collection rate for one labelled billing period.
 *
 * Both inputs must already refer to the same period label; this helper does
 * not mix a cash window with a billing-period total. Non-finite inputs are
 * normalised to 0 so the result is always serialisable (never NaN/Infinity).
 */
export function collectionRate(input: {
  collectedMinor: number;
  billedMinor: number;
}): CollectionRateResult {
  const collectedMinor = Number.isFinite(input.collectedMinor)
    ? input.collectedMinor
    : 0;
  const billedMinor = Number.isFinite(input.billedMinor) ? input.billedMinor : 0;
  return {
    rate: ratio(collectedMinor, billedMinor),
    basis: "billing-period",
    numeratorMinor: collectedMinor,
    denominatorMinor: billedMinor,
  };
}

export interface ChangeResult {
  delta: number;
  direction: "up" | "down" | "flat";
  /** Relative change against the absolute previous value, or null. */
  percent: number | null;
  /** Whether the move is desirable for this metric, or null when flat. */
  good: boolean | null;
}

/**
 * Compare two values of the same metric.
 *
 * Non-finite inputs (missing or still-loading aggregates) return a flat,
 * neutral result with delta 0 and no percentage. A percentage against an
 * unknown value would be misleading, and a flat change has no good/bad
 * direction.
 */
export function change(
  current: number,
  previous: number,
  options: { higherIsBetter: boolean },
): ChangeResult {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { delta: 0, direction: "flat", percent: null, good: null };
  }

  const delta = current - previous;
  if (delta === 0) {
    return {
      delta: 0,
      direction: "flat",
      percent: previous === 0 ? null : 0,
      good: null,
    };
  }

  const direction = delta > 0 ? "up" : "down";
  return {
    delta,
    direction,
    percent:
      previous === 0 ? null : delta / Math.abs(previous),
    good: (direction === "up") === options.higherIsBetter,
  };
}
