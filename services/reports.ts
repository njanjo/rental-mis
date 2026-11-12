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
import {
  assertCapability,
  hasGlobalScope,
  requireAccount,
  scopePropertyIds,
} from "@/lib/auth/scope";
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
  Lease,
  Payment,
  PaymentProvider,
  PaymentStatus,
  Property,
  Tenant,
  Unit,
  UnmatchedPayment,
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
  accountId: string,
  start: Date,
  scope: string[] | null,
): Promise<Payment[]> {
  const snapshot = await adminDb()
    .collection(PAYMENTS)
    .where("accountId", "==", accountId)
    .where("receivedAt", ">=", Timestamp.fromDate(start))
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as Payment)
    .filter((payment) => inScope(scope, payment.propertyId));
}

async function outstandingInvoices(
  accountId: string,
  scope: string[] | null,
): Promise<Invoice[]> {
  const snapshot = await adminDb()
    .collection(INVOICES)
    .where("accountId", "==", accountId)
    .where("status", "in", [...OUTSTANDING_STATUSES])
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Invoice), id: doc.id }))
    .filter((invoice) => inScope(scope, invoice.propertyId));
}

async function activeUnits(
  accountId: string,
  scope: string[] | null,
): Promise<Unit[]> {
  const snapshot = await adminDb()
    .collection(UNITS)
    .where("accountId", "==", accountId)
    .where("active", "==", true)
    .limit(SCAN_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as Unit)
    .filter((unit) => inScope(scope, unit.propertyId));
}

async function propertyNames(
  accountId: string,
  scope: string[] | null,
): Promise<Map<string, string>> {
  const snapshot = await adminDb()
    .collection(PROPERTIES)
    .where("accountId", "==", accountId)
    .limit(SCAN_LIMIT)
    .get();
  const map = new Map<string, string>();
  snapshot.docs.forEach((doc) => {
    const property = doc.data() as Property;
    if (inScope(scope, doc.id)) map.set(doc.id, property.name);
  });
  return map;
}

async function tenantNames(
  accountId: string,
  tenantIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(tenantIds.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snapshot = await adminDb()
      .collection(TENANTS)
      .where("accountId", "==", accountId)
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

export interface UnmatchedQueueRow {
  id: string;
  paymentId: string;
  reason: string;
  createdAt: unknown;
  /** Resolved from the payment so scoping and ageing can use the ledger. */
  propertyId?: string;
  receivedAt?: unknown;
  amountMinor: number;
}

/**
 * The live review queue with the payment denormalised onto each row. Queue
 * rows carry no property of their own, so scoping has to follow the payment.
 */
async function unmatchedQueueRows(
  accountId: string,
  scope: string[] | null,
): Promise<UnmatchedQueueRow[]> {
  const snapshot = await adminDb()
    .collection("unmatchedPayments")
    .where("accountId", "==", accountId)
    .where("reviewStatus", "in", ["pending", "assigned"])
    .limit(SCAN_LIMIT)
    .get();

  const queue = snapshot.docs.map((doc) => {
    const data = doc.data() as UnmatchedPayment;
    return {
      id: doc.id,
      paymentId: data.paymentId,
      reason: data.reason,
      createdAt: data.createdAt,
    };
  });
  const paymentIds = queue.map((row) => row.paymentId);
  const payments = new Map<string, Payment>();
  for (let index = 0; index < paymentIds.length; index += 30) {
    const chunk = paymentIds.slice(index, index + 30).filter(Boolean);
    if (chunk.length === 0) continue;
    const docs = await adminDb()
      .collection(PAYMENTS)
      .where("accountId", "==", accountId)
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    docs.docs.forEach((doc) => {
      payments.set(doc.id, doc.data() as Payment);
    });
  }

  return queue
    .map((row) => {
      const payment = row.paymentId ? payments.get(row.paymentId) : undefined;
      return {
        id: row.id,
        paymentId: row.paymentId,
        reason: row.reason,
        createdAt: row.createdAt,
        propertyId: payment?.propertyId,
        receivedAt: payment?.receivedAt,
        amountMinor: payment?.amountMinor ?? 0,
      };
    })
    .filter((row) => inScope(scope, row.propertyId));
}

// ---------------------------------------------------------------------------
// Dashboard + report aggregations
// ---------------------------------------------------------------------------

export async function dashboardStats(
  actor: SessionUser,
): Promise<DashboardStats> {
  // Dashboard KPIs are financial figures; the view_financials matrix applies.
  const scope = assertAndScope(actor, "view_financials");
  const accountId = requireAccount(actor);

  const now = new Date();
  const currentMonth = monthBounds(nairobiMonthKey(now));

  const [monthPayments, units, invoices, unmatchedQueue] = await Promise.all([
    paymentsSince(accountId, currentMonth.start, scope),
    activeUnits(accountId, scope),
    outstandingInvoices(accountId, scope),
    unmatchedQueueRows(accountId, scope),
  ]);

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
    unmatchedCount: unmatchedQueue.length,
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
  const accountId = requireAccount(actor);
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

  const payments = await paymentsSince(accountId, first.start, scope);
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
  const accountId = requireAccount(actor);
  const invoices = await outstandingInvoices(accountId, scope);

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
  const accountId = requireAccount(actor);
  const payments = await paymentsSince(accountId, from, scope);
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
  const names = await propertyNames(requireAccount(actor), scope);

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

export interface OwnerPropertyRow {
  propertyId: string;
  propertyName: string;
  billedMinor: number;
  collectedMinor: number;
  arrearsMinor: number;
  occupiedUnits: number;
  totalUnits: number;
}

/**
 * Per-property owner view for one Nairobi month. Billed is grouped by invoice
 * periodKey (billing-period basis); collected is money received in that month
 * (cash-received basis); arrears is live as-of-now and stated separately.
 */
export async function ownerMonthlyReport(
  actor: SessionUser,
  monthKey: string,
): Promise<{ monthKey: string; rows: OwnerPropertyRow[]; asOf: string }> {
  const scope = assertAndScope(actor, "view_financials");
  const accountId = requireAccount(actor);
  const bounds = monthBounds(monthKey);

  const [payments, invoicesSnap, arrearsInvoices, units, properties] = await Promise.all([
    paymentsSince(accountId, bounds.start, scope),
    adminDb()
      .collection(INVOICES)
      .where("accountId", "==", accountId)
      .where("periodKey", "==", monthKey)
      .limit(SCAN_LIMIT)
      .get(),
    outstandingInvoices(accountId, scope),
    activeUnits(accountId, scope),
    propertyNames(accountId, scope),
  ]);

  const monthPayments = payments.filter(
    (payment) =>
      toMillis(payment.receivedAt) < bounds.end.getTime() &&
      CASH_STATUSES.includes(payment.status),
  );
  const billedInvoices = invoicesSnap.docs
    .map((doc) => doc.data() as Invoice)
    .filter((invoice) => inScope(scope, invoice.propertyId));

  const byProperty = new Map<string, OwnerPropertyRow>();
  const ensure = (propertyId: string) => {
    if (!byProperty.has(propertyId)) {
      byProperty.set(propertyId, {
        propertyId,
        propertyName: properties.get(propertyId) ?? "Not matched to a property",
        billedMinor: 0,
        collectedMinor: 0,
        arrearsMinor: 0,
        occupiedUnits: 0,
        totalUnits: 0,
      });
    }
    return byProperty.get(propertyId)!;
  };

  for (const [id] of properties) ensure(id);

  for (const payment of monthPayments) {
    const row = ensure(payment.propertyId ?? "unassigned");
    row.collectedMinor += payment.amountMinor ?? 0;
  }
  for (const invoice of billedInvoices) {
    const row = ensure(invoice.propertyId ?? "unassigned");
    row.billedMinor += invoice.amountDueMinor ?? 0;
  }
  for (const invoice of arrearsInvoices) {
    const row = ensure(invoice.propertyId ?? "unassigned");
    row.arrearsMinor += invoice.balanceMinor ?? 0;
  }
  for (const unit of units) {
    const row = ensure(unit.propertyId ?? "unassigned");
    row.totalUnits += 1;
    if (unit.status === "occupied") row.occupiedUnits += 1;
  }

  const rows = [...byProperty.values()]
    .filter(
      (row) =>
        row.propertyId !== "unassigned" ||
        row.billedMinor !== 0 ||
        row.collectedMinor !== 0 ||
        row.arrearsMinor !== 0 ||
        row.totalUnits > 0,
    )
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  return {
    monthKey,
    rows,
    asOf: new Date().toISOString(),
  };
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
  const accountId = requireAccount(actor);
  const [names, tenants] = await Promise.all([
    propertyNames(accountId, scope),
    tenantNames(
      accountId,
      payments.filter((p) => p.tenantId).map((p) => p.tenantId as string),
    ),
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
  const accountId = requireAccount(actor);
  const [invoices, names, unitsSnapshot] = await Promise.all([
    outstandingInvoices(accountId, scope),
    propertyNames(accountId, scope),
    adminDb()
      .collection(UNITS)
      .where("accountId", "==", accountId)
      .limit(SCAN_LIMIT)
      .get(),
  ]);
  const tenantMap = await tenantNames(
    accountId,
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
// Attention queue and dashboard deltas
// ---------------------------------------------------------------------------

export type AttentionTone = "warning" | "danger" | "info";

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  href: string;
  /** Minor units when the item is money-valued. */
  minor?: number;
  count?: number;
}

function daysSince(instant: unknown, nowMs: number): number {
  const ms = toMillis(instant);
  if (!Number.isFinite(ms) || ms === Number.POSITIVE_INFINITY) return 0;
  return Math.max(0, (nowMs - ms) / 86_400_000);
}

export async function attentionQueue(
  actor: SessionUser,
  options: { limit?: number } = {},
): Promise<AttentionItem[]> {
  const scope = assertAndScope(actor, "view_financials");
  const accountId = requireAccount(actor);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
  const nowMs = Date.now();
  const todayDays = Math.floor(nowMs / 86_400_000);
  const in60 = Timestamp.fromMillis(nowMs + 60 * 86_400_000);

  const [
    invoices,
    unmatchedQueue,
    leasesSnap,
    maintenanceSnap,
    properties,
  ] = await Promise.all([
    outstandingInvoices(accountId, scope),
    unmatchedQueueRows(accountId, scope),
    adminDb()
      .collection("leases")
      .where("accountId", "==", accountId)
      .where("status", "==", "active")
      .where("endDate", "<=", in60)
      .limit(SCAN_LIMIT)
      .get(),
    adminDb()
      .collection("maintenanceRequests")
      .where("accountId", "==", accountId)
      .where("status", "in", ["open", "assigned", "in_progress"])
      .limit(SCAN_LIMIT)
      .get(),
    propertyNames(accountId, scope),
  ]);

  const items: AttentionItem[] = [];

  const severeArrears = invoices.filter((invoice) => {
    const days = todayDays - Math.floor(toMillis(invoice.dueDate) / 86_400_000);
    return days > 30;
  });
  if (severeArrears.length > 0) {
    const minor = severeArrears.reduce(
      (sum, invoice) => sum + (invoice.balanceMinor ?? 0),
      0,
    );
    items.push({
      id: "arrears-30d",
      tone: "danger",
      title: "Arrears over 30 days",
      detail: `${severeArrears.length} invoice${severeArrears.length === 1 ? "" : "s"} overdue beyond 30 days`,
      href: "/invoices?status=overdue",
      minor,
      count: severeArrears.length,
    });
  }

  const staleUnmatched = unmatchedQueue.filter(
    (row) => daysSince(row.receivedAt ?? row.createdAt, nowMs) > 1,
  );
  if (staleUnmatched.length > 0) {
    const minor = staleUnmatched.reduce((sum, row) => sum + row.amountMinor, 0);
    items.push({
      id: "unmatched-stale",
      tone: "warning",
      title: "Unmatched payments over 24 hours",
      detail: `${staleUnmatched.length} payment${staleUnmatched.length === 1 ? "" : "s"} waiting for review`,
      href: "/payments/unmatched",
      minor,
      count: staleUnmatched.length,
    });
  }

  const expiringLeases = leasesSnap.docs
    .map((doc) => ({ ...(doc.data() as Lease), id: doc.id }))
    .filter((lease) => inScope(scope, lease.propertyId))
    .filter((lease) => toMillis(lease.endDate) >= nowMs);
  if (expiringLeases.length > 0) {
    expiringLeases.sort((a, b) => toMillis(a.endDate) - toMillis(b.endDate));
    const soonest = expiringLeases[0];
    const daysLeft = Math.max(
      0,
      Math.ceil((toMillis(soonest.endDate) - nowMs) / 86_400_000),
    );
    items.push({
      id: "lease-expiries-60d",
      tone: "warning",
      title: "Leases expiring within 60 days",
      detail: `${expiringLeases.length} lease${expiringLeases.length === 1 ? "" : "s"} · next in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      href: "/leases?status=active",
      count: expiringLeases.length,
    });
  }

  const overdueMaintenance = maintenanceSnap.docs
    .map((doc) => doc.data() as { propertyId?: string; priority?: string; createdAt?: unknown })
    .filter((item) => inScope(scope, item.propertyId))
    .filter((item) => item.priority === "urgent" || item.priority === "high" || daysSince(item.createdAt, nowMs) > 7);
  if (overdueMaintenance.length > 0) {
    items.push({
      id: "maintenance-overdue",
      tone: "info",
      title: "Maintenance needing attention",
      detail: `${overdueMaintenance.length} open request${overdueMaintenance.length === 1 ? "" : "s"} (urgent/high or older than 7 days)`,
      href: "/maintenance",
      count: overdueMaintenance.length,
    });
  }

  // Keep the highest-risk items first and make the list scannable.
  const rank: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone] || (b.minor ?? 0) - (a.minor ?? 0));
  void properties; // reserved for richer detail copy in a follow-up
  return items.slice(0, limit);
}

export interface CollectedComparison {
  currentMinor: number;
  previousMinor: number;
  /** Like-for-like: first N Nairobi days of this month vs same span last month. */
  basisLabel: string;
}

/**
 * Month-to-date collections compared to the same number of days in the previous
 * Nairobi month. Comparing MTD to a full prior month would overstate decline.
 */
export async function collectedMtdComparison(
  actor: SessionUser,
): Promise<CollectedComparison> {
  const scope = assertAndScope(actor, "view_financials");
  const accountId = requireAccount(actor);
  const now = new Date();
  const current = monthBounds(nairobiMonthKey(now));
  const elapsedMs = Math.max(0, now.getTime() - current.start.getTime());

  const prevEnd = new Date(current.start.getTime() - 1);
  const prev = monthBounds(nairobiMonthKey(prevEnd));
  const prevComparableEnd = new Date(
    Math.min(prev.start.getTime() + elapsedMs, prev.end.getTime() - 1),
  );

  const [currentPayments, previousPayments] = await Promise.all([
    paymentsSince(accountId, current.start, scope),
    paymentsSince(accountId, prev.start, scope),
  ]);

  const nowMs = now.getTime();
  const prevEndMs = prevComparableEnd.getTime() + 1;
  const prevStartMs = prev.start.getTime();

  return {
    currentMinor: signedSum(
      currentPayments.filter((p) => toMillis(p.receivedAt) < nowMs),
    ),
    previousMinor: signedSum(
      previousPayments.filter((p) => {
        const ms = toMillis(p.receivedAt);
        return ms >= prevStartMs && ms < prevEndMs;
      }),
    ),
    basisLabel: "vs same days last month",
  };
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
