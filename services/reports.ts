import "server-only";

/**
 * Reporting aggregations.
 *
 * Everything is read-only and computed on the server with the Admin SDK, so
 * every function takes the actor and enforces capability + property scope the
 * same way the operational services do. Aggregations deliberately avoid
 * composite indexes: window queries filter on one field, and the rest of the
 * narrowing (scope, statuses) happens in memory over bounded scans.
 *
 * Money rule ("collected"): a payment counts when its `receivedAt` falls in
 * the window, summed as *signed* minor units. A reversal row carries a
 * negative amount created at reversal time, so the window sum is the net cash
 * per month without extra lookups. Unconfirmed ("received") M-Pesa payloads
 * are excluded — they are not yet reconciled money.
 */

import { FieldPath, Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import { assertCapability, scopePropertyIds } from "@/lib/auth/scope";
import {
  monthBounds,
  nairobiMonthKey,
  parseDateInput,
  toIsoString,
} from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type {
  Invoice,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Property,
  Tenant,
  Unit,
} from "@/lib/types";
import type { Capability } from "@/lib/auth/permissions";

const PAYMENTS = "payments";
const INVOICES = "invoices";
const UNITS = "units";
const TENANTS = "tenants";
const PROPERTIES = "properties";

/** Hard ceiling for in-memory aggregation scans. */
const SCAN_LIMIT = 5_000;

/** Statuses that contribute real money; reversal rows are negative sums. */
const CASH_STATUSES: PaymentStatus[] = ["confirmed", "allocated", "reversal"];

/** Invoice statuses that still represent money owed. */
const OUTSTANDING_STATUSES = ["open", "partial", "overdue"] as const;

export interface DashboardStats {
  /** Occupied units vs the total of active stock. */
  occupancy: { occupied: number; total: number };
  /** Net money received in the Nairobi month in progress. */
  collectedThisMonthMinor: number;
  /** Sum of live invoice balances. */
  arrearsMinor: number;
  /** Invoices awaiting payment, displayed next to the arrears total. */
  arrearsInvoiceCount: number;
  /** Payments sitting in the unmatched review queue, in scope. */
  unmatchedCount: number;
}

export interface AgingBucket {
  label: string;
  minor: number;
  invoices: number;
}

export interface MonthPoint {
  key: string;
  label: string;
  minor: number;
}

export interface NamedBreakdown {
  id: string;
  label: string;
  minor: number;
}

function inScope(scope: string[] | null, propertyId?: string): boolean {
  if (!scope) return true;
  return Boolean(propertyId && scope.includes(propertyId));
}

function assertAndScope(
  actor: SessionUser,
  capability: Capability,
): string[] | null {
  assertCapability(actor, capability);
  return scopePropertyIds(actor);
}

/** Instant in milliseconds; unknown-shaped values sort to infinity. */
function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in (value as Record<string, unknown>)
  ) {
    return (value as Timestamp).toDate().getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
  }
  return Number.POSITIVE_INFINITY;
}

/** Payments received since `start`, scope-filtered in memory. */
async function paymentsSince(
  start: Date,
  scope: string[] | null,
): Promise<Payment[]> {
  const snapshot = await adminDb()
    .collection(PAYMENTS)
    .where("receivedAt", ">=", Timestamp.fromDate(start))
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as Payment)
    .filter((payment) => inScope(scope, payment.propertyId));
}

async function outstandingInvoices(scope: string[] | null): Promise<Invoice[]> {
  const snapshot = await adminDb()
    .collection(INVOICES)
    .where("status", "in", [...OUTSTANDING_STATUSES])
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Invoice), id: doc.id }))
    .filter((invoice) => inScope(scope, invoice.propertyId));
}

async function activeUnits(scope: string[] | null): Promise<Unit[]> {
  const snapshot = await adminDb()
    .collection(UNITS)
    .where("active", "==", true)
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as Unit)
    .filter((unit) => inScope(scope, unit.propertyId));
}

async function propertyNames(scope: string[] | null): Promise<Map<string, string>> {
  const snapshot = await adminDb()
    .collection(PROPERTIES)
    .limit(SCAN_LIMIT)
    .get();
  const map = new Map<string, string>();
  snapshot.docs.forEach((doc) => {
    const property = doc.data() as Property;
    if (inScope(scope, doc.id)) map.set(doc.id, property.name);
  });
  return map;
}

async function tenantNames(tenantIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(tenantIds.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snapshot = await adminDb()
      .collection(TENANTS)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      map.set(doc.id, (doc.data() as Tenant).fullName);
    });
  }
  return map;
}

function signedSum(payments: Payment[]): number {
  return payments.reduce(
    (total, payment) =>
      CASH_STATUSES.includes(payment.status)
        ? total + (payment.amountMinor ?? 0)
        : total,
    0,
  );
}

// ---------------------------------------------------------------------------
// Dashboard + report aggregations
// ---------------------------------------------------------------------------

export async function dashboardStats(
  actor: SessionUser,
): Promise<DashboardStats> {
  // Dashboard KPIs are financial figures; the view_financials matrix applies.
  const scope = assertAndScope(actor, "view_financials");

  const now = new Date();
  const currentMonth = monthBounds(nairobiMonthKey(now));

  const [monthPayments, units, invoices, unmatchedSnapshot] = await Promise.all([
    paymentsSince(currentMonth.start, scope),
    activeUnits(scope),
    outstandingInvoices(scope),
    adminDb()
      .collection("unmatchedPayments")
      .where("reviewStatus", "in", ["pending", "assigned"])
      .limit(SCAN_LIMIT)
      .get(),
  ]);

  // Unmatched rows carry no propertyId of their own; scope them by finding the
  // property of the payment each queue row points at.
  const queuePaymentIds = unmatchedSnapshot.docs.map(
    (doc) => (doc.data() as { paymentId: string }).paymentId,
  );
  const paymentProperties = new Map<string, string | undefined>();
  for (let index = 0; index < queuePaymentIds.length; index += 30) {
    const chunk = queuePaymentIds.slice(index, index + 30);
    const docs = await adminDb()
      .collection(PAYMENTS)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    docs.docs.forEach((doc) => {
      paymentProperties.set(doc.id, (doc.data() as Payment).propertyId);
    });
  }
  const unmatchedCount = unmatchedSnapshot.docs.filter((doc) =>
    inScope(
      scope,
      paymentProperties.get((doc.data() as { paymentId: string }).paymentId),
    ),
  ).length;

  return {
    occupancy: {
      occupied: units.filter((unit) => unit.status === "occupied").length,
      total: units.length,
    },
    collectedThisMonthMinor: signedSum(
      monthPayments.filter(
        (payment) => toMillis(payment.receivedAt) < currentMonth.end.getTime(),
      ),
    ),
    arrearsMinor: invoices.reduce(
      (total, invoice) => total + (invoice.balanceMinor ?? 0),
      0,
    ),
    arrearsInvoiceCount: invoices.length,
    unmatchedCount,
  };
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Oct 2026" labelling, exported for tables and charts. */
export function monthLabel(monthKey: string): string {
  const name = MONTH_NAMES[Number(monthKey.split("-")[1]) - 1];
  return name ? `${name} ${monthKey.split("-")[0]}` : monthKey;
}

export async function collectionTrend(
  actor: SessionUser,
  months = 6,
): Promise<MonthPoint[]> {
  const scope = assertAndScope(actor, "view_financials");
  const clamped = Math.min(Math.max(months, 1), 24);

  const currentKey = nairobiMonthKey(new Date());
  const keys: string[] = [];
  let key = currentKey;
  for (let step = 0; step < clamped; step += 1) {
    keys.unshift(key);
    const [year, month] = key.split("-").map(Number) as [number, number];
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    key = `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
  }
  const first = monthBounds(keys[0]);

  const payments = await paymentsSince(first.start, scope);
  const totals = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const payment of payments) {
    if (!CASH_STATUSES.includes(payment.status)) continue;
    const paymentKey = nairobiMonthKey(toMillis(payment.receivedAt));
    if (!totals.has(paymentKey)) continue;
    totals.set(paymentKey, (totals.get(paymentKey) ?? 0) + (payment.amountMinor ?? 0));
  }

  return keys.map((monthKey) => ({
    key: monthKey,
    label: monthLabel(monthKey),
    minor: totals.get(monthKey) ?? 0,
  }));
}

/** Arrears by days past due: not yet due, 1–30, 31–60, 61–90, 90+. */
export async function arrearsAging(actor: SessionUser): Promise<AgingBucket[]> {
  const scope = assertAndScope(actor, "view_financials");
  const invoices = await outstandingInvoices(scope);

  const todayDays = Math.floor(Date.now() / 86_400_000);
  const buckets: AgingBucket[] = [
    { label: "Not yet due", minor: 0, invoices: 0 },
    { label: "1–30 days", minor: 0, invoices: 0 },
    { label: "31–60 days", minor: 0, invoices: 0 },
    { label: "61–90 days", minor: 0, invoices: 0 },
    { label: "90+ days", minor: 0, invoices: 0 },
  ];

  for (const invoice of invoices) {
    const daysOverdue = Math.max(
      0,
      todayDays - Math.floor(toMillis(invoice.dueDate) / 86_400_000),
    );
    const index = bucketIndexForDays(daysOverdue);
    buckets[index].minor += invoice.balanceMinor ?? 0;
    buckets[index].invoices += 1;
  }
  return buckets;
}

function bucketIndexForDays(days: number): 0 | 1 | 2 | 3 | 4 {
  if (days <= 0) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  if (days <= 90) return 3;
  return 4;
}

/** Windowed payments after the report capability and scope are enforced. */
async function windowPayments(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<Payment[]> {
  const scope = assertAndScope(actor, "export_reports");
  const payments = await paymentsSince(from, scope);
  const end = to.getTime();
  return payments.filter(
    (payment) =>
      toMillis(payment.receivedAt) < end && CASH_STATUSES.includes(payment.status),
  );
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
  manual: "Manual receipt",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as PaymentProvider] ?? provider;
}

export async function incomeByProperty(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<NamedBreakdown[]> {
  const payments = await windowPayments(actor, from, to);
  const scope = hasGlobalScope(actor) ? null : [...new Set(actor.propertyIds)];
  const names = await propertyNames(scope);

  return groupTotals(payments, (payment) => payment.propertyId ?? "unassigned")
    .map(({ id, minor }) => ({
      id,
      label: names.get(id) ?? "Not matched to a property",
      minor,
    }))
    .sort((a, b) => b.minor - a.minor || a.label.localeCompare(b.label));
}

export async function incomeByChannel(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<NamedBreakdown[]> {
  const payments = await windowPayments(actor, from, to);
  return groupTotals(payments, (payment) => payment.provider).map(
    ({ id, minor }) => ({ id, label: providerLabel(id), minor }),
  );
}

/** Net money grouped by Nairobi month inside the window, oldest first. */
export async function incomeByMonth(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<MonthPoint[]> {
  const payments = await windowPayments(actor, from, to);
  const totals = new Map<string, number>();
  for (const payment of payments) {
    const key = nairobiMonthKey(toMillis(payment.receivedAt));
    totals.set(key, (totals.get(key) ?? 0) + (payment.amountMinor ?? 0));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, minor]) => ({ key, label: monthLabel(key), minor }));
}

function hasGlobalScope(actor: SessionUser): boolean {
  return actor.role === "admin" || actor.role === "auditor";
}

function groupTotals(
  payments: Payment[],
  keyOf: (payment: Payment) => string,
): Array<{ id: string; minor: number }> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    totals.set(keyOf(payment), (totals.get(keyOf(payment)) ?? 0) + (payment.amountMinor ?? 0));
  }
  return [...totals.entries()]
    .map(([id, minor]) => ({ id, minor }))
    .sort((a, b) => b.minor - a.minor);
}

// ---------------------------------------------------------------------------
// CSV export row builders
// ---------------------------------------------------------------------------

export interface PaymentExportRow {
  receivedAt: string;
  provider: string;
  reference: string;
  tenant: string;
  property: string;
  status: string;
  amountMinor: number;
}

/** Payments in the window, oldest first, decorated with names for CSV. */
export async function paymentsForExport(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<PaymentExportRow[]> {
  const payments = await windowPayments(actor, from, to);
  const scope = hasGlobalScope(actor) ? null : [...new Set(actor.propertyIds)];
  const [names, tenants] = await Promise.all([
    propertyNames(scope),
    tenantNames(payments.filter((p) => p.tenantId).map((p) => p.tenantId as string)),
  ]);

  return payments
    .map((payment) => ({
      receivedAt: toIsoString(payment.receivedAt) ?? "",
      provider: providerLabel(payment.provider),
      reference: payment.providerTransactionId,
      tenant: payment.tenantId ? tenants.get(payment.tenantId) ?? "—" : "—",
      property: payment.propertyId
        ? names.get(payment.propertyId) ?? "—"
        : "—",
      status: payment.status,
      amountMinor: payment.amountMinor,
    }))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export interface ArrearsExportRow {
  tenant: string;
  property: string;
  unit: string;
  periodKey: string;
  dueDate: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  status: string;
}

/** Live arrears rows, oldest due date first. */
export async function arrearsForExport(
  actor: SessionUser,
): Promise<ArrearsExportRow[]> {
  const scope = assertAndScope(actor, "export_reports");
  const [invoices, names, unitsSnapshot] = await Promise.all([
    outstandingInvoices(scope),
    propertyNames(scope),
    adminDb().collection(UNITS).limit(SCAN_LIMIT).get(),
  ]);
  const tenantMap = await tenantNames(
    invoices.filter((invoice) => invoice.tenantId).map((i) => i.tenantId),
  );
  const unitNumbers = new Map<string, string>();
  unitsSnapshot.docs.forEach((doc) => {
    unitNumbers.set(doc.id, (doc.data() as Unit).unitNumber);
  });

  return invoices
    .map((invoice) => ({
      tenant: tenantMap.get(invoice.tenantId) ?? "—",
      property: names.get(invoice.propertyId) ?? "—",
      unit: unitNumbers.get(invoice.unitId) ?? "—",
      periodKey: invoice.periodKey,
      dueDate: toIsoString(invoice.dueDate) ?? "",
      amountDueMinor: invoice.amountDueMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      balanceMinor: invoice.balanceMinor,
      status: invoice.status,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------------------------------------------------------------------
// Report window parsing shared by the reports page and the CSV route
// ---------------------------------------------------------------------------

export interface ReportWindow {
  /** Inclusive lower bound (midnight Nairobi on `from`). */
  from: Date;
  /** Exclusive upper bound (midnight Nairobi the day after `to`). */
  to: Date;
  fromInput: string;
  toInput: string;
}

/**
 * Parse `from`/`to` form values; default to the trailing 90 days, inclusive
 * of today. The UI treats both edges as inclusive days.
 */
export function parseReportWindow(
  fromInput?: string,
  toInput?: string,
): ReportWindow {
  const fallbackTo = new Date();
  if (fromInput && !parseDateInput(fromInput)) {
    throw new ServiceError("validation", "`from` must be a valid calendar day.");
  }
  if (toInput && !parseDateInput(toInput)) {
    throw new ServiceError("validation", "`to` must be a valid calendar day.");
  }
  const to = toInput ? parseDateInput(toInput) : fallbackTo;
  const from =
    fromInput
      ? parseDateInput(fromInput)
      : new Date(fallbackTo.getTime() - 89 * 86_400_000);
  if (!to || !from) {
    throw new ServiceError("validation", "A valid date range is required.");
  }
  // Include the whole of the `to` day by making the bound exclusive.
  const end = new Date(to.getTime() + 86_400_000);
  if (end.getTime() <= from.getTime()) {
    throw new ServiceError("validation", "The `to` date must be after `from`.");
  }
  // Unknown-shaped seconds are impossible after parseDateInput.
  return {
    from,
    to: end,
    fromInput: from.toISOString().slice(0, 10),
    toInput: to.toISOString().slice(0, 10),
  };
}
