import "server-only";

/**
 * Reporting aggregations.
 *
 * Everything is read-only and computed on the server with the Admin SDK, so
 * every function takes the actor and enforces capability + property scope the
 * same way the operational services do. Aggregations deliberately avoid
 * composite indexes: windows filter on one field and the rest of the narrowing
 * (scope, statuses) happens in memory over bounded scans.
 *
 * Money rules ("collected"): payments whose `receivedAt` falls in the window
 * count, summed as signed minor units. A reversal row carries a negative
 * amount created at reversal time, which makes the window sum the *net* cash
 * for each month without extra lookups. Unconfirmed ("received") M-Pesa
 * payloads are excluded — they are not yet reconciled money.
 */

import { Timestamp } from "firebase-admin/firestore";

import type { SessionUser } from "@/lib/auth/session";
import {
  scopePropertyIds,
  type ScopeUpdate,
  assertCapability,
  hasGlobalScope,
} from "@/lib/auth/scope";
import { monthBounds, nairobiMonthKey, parseDateInput, toIsoString } from "@/lib/dates";
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

const PAYMENTS = "payments";
const INVOICES = "invoices";
const UNITS = "units";
const TENANTS = "tenants";
const PROPERTIES = "properties";

/** Hard ceiling for in-memory aggregation scans. */
const SCAN_LIMIT = 5_000;

/** Statuses that contribute real money; reversal rows are negative sums. */
const CASH_STATUSES: PaymentStatus[] = ["confirmed", "allocated", "reversal"];

/** Statuses that still represent money owed on an invoice. */
const OUTSTANDING_STATUSES = ["open", "partial", "overdue"] as const;

export interface DashboardStats {
  /** Units that are active reports: occupied vs the total active stock. */
  occupancy: { occupied: number; total: number };
  /** Net money received in the Nairobi month in progress. */
  collectedThisMonthMinor: number;
  /** Sum of live invoice balances. */
  arrearsMinor: number;
  /** Invoices awaiting payment, for display next to the arrears total. */
  arrearsInvoiceCount: number;
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

interface ScopedSnapshot {
  scope: string[] | null;
  docs: Array<{ propertyId?: string; data: unknown }>;
}

function inScope(scope: string[] | null, propertyId?: string): boolean {
  if (!scope) return true;
  return Boolean(propertyId && scope.includes(propertyId));
}

/** Confirm the actor may look at money and returns their property scope. */
function reportingScope(actor: SessionUser, capability: Parameters<typeof assertCapability>[1]): {
  scope: string[] | null;
} {
  assertCapability(actor, capability);
  return { scope: scopePropertyIds(actor) };
}

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

async function outstandingInvoices(
  scope: string[] | null,
): Promise<Invoice[]> {
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

/** Property id -> name, resolved via chunked document lookups. */
async function propertyNames(scope: string[] | null): Promise<Map<string, string>> {
  const snapshot = await adminDb().collection(PROPERTIES).limit(SCAN_LIMIT).get();
  const map = new Map<string, string>();
  snapshot.docs.forEach((doc) => {
    const property = doc.data() as Property;
    if (inScope(scope, doc.id)) map.set(doc.id, property.name);
  });
  return map;
}

async function tenantNames(tenantIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tenantIds.length === 0) return map;
  const unique = [...new Set(tenantIds)];
  const db = adminDb();
  // Firestore allows at most 30 values per `in` chunk.
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snapshot = await db
      .collection(TENANTS)
      .where("__name__", "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      map.set(doc.id, (doc.data() as Tenant).fullName);
    });
  }
  return map;
}

/** Signed net money for payments, grouping by month key. */
function sumPayments(payments: Payment[]): number {
  return payments.reduce(
    (total, payment) =>
      CASH_STATUSES.includes(payment.status) ? total + (payment.amountMinor ?? 0) : total,
    0,
  );
}

export async function dashboardStats(
  actor: SessionUser,
): Promise<DashboardStats> {
  const { scope } = reportingScope(actor, "view_financials");

  const now = new Date();
  const currentMonth = monthBounds(nairobiMonthKey(now));
  const monthPayments = await paymentsSince(currentMonth.start, scope);

  const [units, invoices, unmatchedSnapshot] = await Promise.all([
    activeUnits(scope),
    outstandingInvoices(scope),
    adminDb()
      .collection("unmatchedPayments")
      .where("reviewStatus", "in", ["pending", "assigned"])
      .limit(SCAN_LIMIT)
      .get(),
  ]);

  // Unmatched rows carry no property of their own; they inherit it from the
  // payment they queue. Resolve that link before scope-filtering.
  const unmatchedPaymentIds = unmatchedSnapshot.docs.map(
    (doc) => (doc.data() as { paymentId: string }).paymentId,
  );
  const unmatchedLookup = new Map<string, string | undefined>();
  for (let index = 0; index < unmatchedPaymentIds.length; index += 30) {
    const chunk = unmatchedPaymentIds.slice(index, index + 30);
    const docs = await adminDb()
      .collection(PAYMENTS)
      .where("__name__", "in", chunk)
      .get();
    docs.docs.forEach((doc) => {
      unmatchedLookup.set(doc.id, (doc.data() as Payment).propertyId);
    });
  }
  const unmatchedCount = unmatchedSnapshot.docs.filter((doc) =>
    inScope(
      scope,
      unmatchedLookup.get((doc.data() as { paymentId: string }).paymentId),
    ),
  ).length;

  const occupied = units.filter((unit) => unit.status === "occupied").length;
  const arrearsMinor = invoices.reduce(
    (total, invoice) => total + (invoice.balanceMinor ?? 0),
    0,
  );

  return {
    occupancy: { occupied, total: units.length },
    collectedThisMonthMinor: sumPayments(
      monthPayments.filter((payment) => toMillis(payment.createdAt) < currentMonth.end.getTime()),
    ),
    arrearsMinor,
    arrearsInvoiceCount: invoices.length,
    ...(unmatchedCount >= 0 ? {} : {}),
  } as DashboardStats & { unmatchedCount: number } extends never ? never : DashboardStats;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
  }
  return Number.POSITIVE_INFINITY;
}

/** Last `months` Nairobi months including the current one, oldest first. */
export async function collectionTrend(
  actor: SessionUser,
  months = 6,
): Promise<MonthPoint[]> {
  const { scope } = reportingScope(actor, "view_financials");

  // Walk back to the start of the month `months - 1` ago.
  const key = nairobiMonthKey(new Date());
  let bounds = monthBounds(key);
  let keys = [key];
  for (let step = 1; step < months; step += 1) {
    const [year, month] = bounds.nextKey.split("-").map(Number) as [number, number];
    let previousMonth = month - 1;
    let previousYear = year;
    if (previousMonth === 0) {
      previousMonth = 12;
      previousYear -= 1;
    }
    const previousKey = `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
    bounds = monthBounds(previousKey);
    keys = [previousKey, ...keys];
  }

  const payments = await paymentsSince(bounds.start, scope);
  const totals = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const payment of payments) {
    if (!CASH_STATUSES.includes(payment.status)) continue;
    const paymentKey = nairobiMonthKey(
      typeof payment.receivedAt === "object" && payment.receivedAt !== null && "toDate" in (payment.receivedAt as object)
        ? (payment.receivedAt as Timestamp).toDate()
        : new Date(String(payment.receivedAt)),
    );
    if (!totals.has(paymentKey)) continue;
    totals.set(paymentKey, (totals.get(paymentKey) ?? 0) + (payment.amountMinor ?? 0));
  }

  return keys.map((monthKey) => ({
    key: monthKey,
    label: monthLabel(monthKey),
    minor: totals.get(monthKey) ?? 0,
  }));
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? month;
  return `${name} ${year}`;
}

/** Arrears by days past due: not yet due, 1-30, 31-60, 61-90, 90+. */
export async function arrearsAging(
  actor: SessionUser,
): Promise<AgingBucket[]> {
  const { scope } = reportingScope(actor, "view_financials");
  const invoices = await outstandingInvoices(scope);

  const nowDays = Math.floor(Date.now() / 86_400_000);
  const buckets: AgingBucket[] = [
    { label: "Not yet due", minor: 0, invoices: 0 },
    { label: "1–30 days", minor: 0, invoices: 0 },
    { label: "31–60 days", minor: 0, invoices: 0 },
    { label: "61–90 days", minor: 0, invoices: 0 },
    { label: "90+ days", minor: 0, invoices: 0 },
  ];

  for (const invoice of invoices) {
    const due = toMillis(invoice.dueDate) / 86_400_000;
    const daysOverdue = Math.max(0, Math.floor(nowDays) - Math.floor(due));
    const bucketIndex =
      daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4;
    buckets[bucketIndex].minor += invoice.balanceMinor ?? 0;
    buckets[bucketIndex].invoices += 1;
  }
  return buckets;
}

/** Net money grouped by one dimension over a window. */
async function windowPayments(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<Payment[]> {
  const { scope } = reportingScope(actor, "export_reports");
  const payments = await paymentsSince(from, scope);
  const end = to.getTime();
  return payments.filter(
    (payment) => toMillis(payment.receivedAt) < end && CASH_STATUSES.includes(payment.status),
  );
}

export async function incomeByProperty(
  actor: SessionUser,
  from: Date,
  to: Date,
): Promise<NamedBreakdown[]> {
  const payments = await windowPayments(actor, from, to);
  const names = await propertyNames(scopeOf(actor));
  return groupTotals(payments, (payment) => payment.propertyId ?? "unassigned")
    .map(({ id, minor }) => ({
      id,
      label: names.get(id) ?? "Not assigned to a property",
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
    ({ id, minor }) => ({ id, label: providerLabel(id as PaymentProvider), minor }),
  );
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
  manual: "Manual receipt",
};

export function providerLabel(provider: PaymentProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function groupTotals(
  payments: Payment[],
  keyOf: (payment: Payment) => string,
): Array<{ id: string; minor: number }> {
  return [...groupTotalsMap(payments, keyOf).entries()]
    .map(([id, minor]) => ({ id, minor }))
    .sort((a, b) => b.minor - a.minor);
}

function groupTotalsMap(
  payments: Payment[],
  keyOf: (payment: Payment) => string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    const key = keyOf(payment);
    totals.set(key, (totals.get(key) ?? 0) + (payment.amountMinor ?? 0));
  }
  return totals;
}

// ---------------------------------------------------------------------------
// CSV exports
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
  const names = await propertyNames(scopeOf(actor));
  const scopedPaymentIds = payments
    .filter((payment) => payment.tenantId)
    .map((payment) => payment.tenantId as string);
  const tenants = await tenantNames(scopedPaymentIds);

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
  const { scope } = scopeOfForExport(actor);
  const [invoices, names, unitsSnapshot] = await Promise.all([
    outstandingInvoices(scope),
    propertyNames(scope),
    adminDb().collection(UNITS).limit(SCAN_LIMIT).get(),
  ]);
  const unitNumbers = new Map<string, string>();
  unitsSnapshot.docs.forEach((doc) => {
    unitNumbers.set(doc.id, (doc.data() as Unit).unitNumber);
  });
  const tenants = await tenantNames(
    invoices.filter((invoice) => invoice.tenantId).map((i) => i.tenantId),
  );

  return invoices
    .map((invoice) => ({
      tenant: tenants.get(invoice.tenantId) ?? "—",
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

function scopeOfForExport(actor: SessionUser): {
  scope: string[] | null;
} {
  assertCapability(actor, "export_reports");
  return { scope: scopePropertyIds(actor) };
}

function scopeOf(actor: SessionUser): string[] | null {
  // Aggregation helpers called after windowPayments have already asserted the
  // capability; this re-derives the scope without a second permission check.
  return hasGlobalScope(actor) ? null : [...new Set(actor.propertyIds)];
}

// ---------------------------------------------------------------------------
// Window parsing shared by the reports page and the CSV route
// ---------------------------------------------------------------------------

export interface ReportWindow {
  from: Date;
  to: Date;
  fromInput: string;
  toInput: string;
}

/**
 * Parse the `from`/`to` form values; defaults to the last 90 Nairobi days,
 * inclusive of today. `to` is treated as an exclusive upper bound internally
 * but inclusive in the UI (end of that day).
 */
export function parseReportWindow(
  fromInput?: string,
  toInput?: string,
): ReportWindow {
  const fallbackTo = new Date();
  const fallbackFrom = new Date(fallbackTo.getTime() - 89 * 86_400_000);

  const to = toInput ? parseDateInput(toInput) : fallbackTo;
  const from = fromInput ? parseDateInput(fromInput) : fallbackFrom;
  if (
    !to ||
    !from ||
    (fromInput && !parseDateInput(fromInput)) ||
    (toInput && !parseDateInput(toInput))
  ) {
    throw new ServiceError("validation", "Dates must be valid calendar days.");
  }
  // Include the whole of the `to` day: shift the exclusive end past midnight.
  const end = new Date(to.getTime() + 86_400_000);
  if (end.getTime() <= from.getTime()) {
    throw new ServiceError("validation", "The 'to' date must be after 'from'.");
  }
  return { from, to: end, fromInput: from.toISOString().slice(0, 10), toInput: to.toISOString().slice(0, 10) };
}

export type { ScopeUpdate };
