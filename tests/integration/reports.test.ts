import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import {
  arrearsAging,
  arrearsForExport,
  collectionTrend,
  dashboardStats,
  incomeByChannel,
  incomeByMonth,
  incomeByProperty,
  paymentsForExport,
} from "@/services/reports";

const db = () => adminDb();

const admin: SessionUser = {
  uid: "uid_admin",
  email: "admin@rentalmis.test",
  fullName: "Admin",
  role: "admin",
  active: true,
  propertyIds: [],
};

const scoped: SessionUser = {
  ...admin,
  uid: "uid_pm",
  email: "pm@rentalmis.test",
  fullName: "Manager",
  role: "property_manager",
  propertyIds: ["prop_1"],
};

const DAY = 86_400_000;

function stamp(daysAgo: number): Date {
  return new Date(stubNow - daysAgo * DAY);
}

async function seedPortfolio(): Promise<void> {
  // Two properties, three active units, one of them vacant.
  const properties = db().batch();
  properties.set(db().collection("properties").doc("prop_1"), {
    name: "Kileleshwa Apartments",
    nameLower: "kileleshwa apartments",
    address: "1 Kileleshwa",
    county: "Nairobi",
    managerIds: [],
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  properties.set(db().collection("properties").doc("prop_2"), {
    name: "Ngong Plaza",
    nameLower: "ngong plaza",
    address: "2 Ngong",
    county: "Nairobi",
    managerIds: [],
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await properties.commit();

  const units = db().batch();
  const makeUnit = (
    id: string,
    propertyId: string,
    status: "occupied" | "vacant",
  ) =>
    units.set(db().collection("units").doc(id), {
      propertyId,
      unitNumber: id.toUpperCase(),
      rentAmountMinor: 4_500_000,
      depositAmountMinor: 9_000_000,
      currency: "KES",
      status,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  makeUnit("unit_1", "prop_1", "occupied");
  makeUnit("unit_2", "prop_1", "vacant");
  makeUnit("unit_3", "prop_2", "occupied");
  await units.commit();

  await db()
    .collection("tenants")
    .doc("tnt_1")
    .set({
      fullName: "Grace Wanjiru",
      fullNameLower: "grace wanjiru",
      status: "active",
      propertyIds: ["prop_1"],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Payment rows. Received instants are anchored with `stubNow` so the window
 * math is deterministic even if the suite runs just before midnight in
 * Nairobi.
 */
let stubNow = Date.now();

async function seedPayment(options: {
  propertyId?: string;
  provider: "mpesa" | "bank" | "manual";
  status: "confirmed" | "allocated" | "reversal" | "received" | "unmatched";
  amountMinor: number;
  daysAgo: number;
  tenantId?: string;
  reference?: string;
}): Promise<void> {
  await db()
    .collection("payments")
    .doc()
    .create({
      provider: options.provider,
      providerTransactionId:
        options.reference ?? `ref_${Math.random().toString(36).slice(2, 12)}`,
      amountMinor: options.amountMinor,
      currency: "KES",
      status: options.status,
      source: "manual",
      ...(options.propertyId ? { propertyId: options.propertyId } : {}),
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      receivedAt: Timestamp.fromMillis(stubNow - options.daysAgo * DAY),
      createdAt: Timestamp.fromMillis(stubNow - options.daysAgo * DAY),
      updatedAt: Timestamp.fromMillis(stubNow - options.daysAgo * DAY),
    });
}

async function seedInvoice(dueDaysFromNow: number, options: {
  propertyId?: string;
  status?: "open" | "partial" | "paid" | "void";
  balanceMinor: number;
}): Promise<void> {
  await db()
    .collection("invoices")
    .doc()
    .create({
      tenantId: "tnt_1",
      leaseId: "lease_1",
      unitId: "unit_1",
      propertyId: options.propertyId ?? "prop_1",
      periodKey: "2026-10",
      dueDate: Timestamp.fromMillis(stubNow + dueDaysFromNow * DAY),
      amountDueMinor: 4_500_000,
      amountPaidMinor: 4_500_000 - options.balanceMinor,
      balanceMinor: options.balanceMinor,
      currency: "KES",
      status: options.status ?? "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

const COLLECTIONS = [
  "payments",
  "invoices",
  "unmatchedPayments",
  "units",
  "properties",
  "tenants",
] as const;

beforeEach(async () => {
  stubNow = Date.now();
  const firestore = db();
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("dashboardStats", () => {
  it("summarises occupancy, month collections, arrears and unmatched", async () => {
    await seedPortfolio();

    await Promise.all([
      // In the current month window (negative day offsets are future-proof
      // against the suite starting a few seconds shy of midnight).
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 4_500_000, daysAgo: 0.01 }),
      seedPayment({ propertyId: "prop_2", provider: "bank", status: "confirmed", amountMinor: 3_000_000, daysAgo: 0.02 }),
      // Not money yet: unconfirmed and unmatched rows never count.
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "received", amountMinor: 10_000_000, daysAgo: 0.03 }),
      // Reversal rows subtract.
      seedPayment({ propertyId: "prop_1", provider: "manual", status: "reversal", amountMinor: -1_500_000, daysAgo: 0.04 }),
      // Older than this month: excluded from this month's total.
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 99_000_000, daysAgo: 95 }),
    ]);

    await Promise.all([
      seedInvoice(-10, { balanceMinor: 4_500_000 }),
      seedInvoice(-45, { propertyId: "prop_2", status: "partial", balanceMinor: 1_000_000 }),
      seedInvoice(5, { status: "paid", balanceMinor: 0 }),
      seedInvoice(99, { status: "void", balanceMinor: 9_999_999 }),
    ]);

    await Promise.all([
      db()
        .collection("unmatchedPayments")
        .doc("un_1")
        .create({ paymentId: "pay_missing", candidateTenantIds: [], reason: "x", reviewStatus: "pending", createdAt: FieldValue.serverTimestamp() }),
      db()
        .collection("unmatchedPayments")
        .doc("un_2")
        .create({ paymentId: "pay_missing", candidateTenantIds: [], reason: "x", reviewStatus: "resolved", createdAt: FieldValue.serverTimestamp() }),
    ]);

    // pending payment found so its property scopes the queue row in.
    await db()
      .collection("payments")
      .doc("pay_missing")
      .create({
        provider: "mpesa",
        providerTransactionId: "pay_missing",
        amountMinor: 2_000_000,
        currency: "KES",
        status: "received",
        propertyId: "prop_1",
        receivedAt: Timestamp.fromMillis(stubNow),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    const stats = await dashboardStats(admin);

    // 2 of 3 units occupied.
    expect(stats.occupancy).toEqual({ occupied: 2, total: 3 });
    // allocated 45,000 + confirmed 30,000 − reversal 15,000; `received` ignored.
    expect(stats.collectedThisMonthMinor).toBe(4_500_000 + 3_000_000 - 1_500_000);
    // void and paid invoices are excluded.
    expect(stats.arrearsMinor).toBe(4_500_000 + 1_000_000);
    expect(stats.arrearsInvoiceCount).toBe(2);
    // One pending queue row pointing at a known payment; resolved excluded.
    expect(stats.unmatchedCount).toBe(1);
  });

  it("scopes every figure to the actor's properties", async () => {
    await seedPortfolio();
    await Promise.all([
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 4_500_000, daysAgo: 0.01 }),
      seedPayment({ propertyId: "prop_2", provider: "mpesa", status: "allocated", amountMinor: 3_000_000, daysAgo: 0.02 }),
      seedInvoice(-10, { balanceMinor: 4_500_000 }),
      seedInvoice(-10, { propertyId: "prop_2", balanceMinor: 7_000_000 }),
    ]);

    const stats = await dashboardStats(scoped);
    expect(stats.occupancy).toEqual({ occupied: 1, total: 2 });
    expect(stats.collectedThisMonthMinor).toBe(4_500_000);
    expect(stats.arrearsMinor).toBe(4_500_000);
  });
});

describe("collectionTrend", () => {
  it("returns signed sums for the last months including today", async () => {
    await seedPortfolio();
    await Promise.all([
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 4_500_000, daysAgo: 0.01 }),
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 2_000_000, daysAgo: 35 }),
      seedPayment({ propertyId: "prop_1", provider: "bank", status: "reversal", amountMinor: -500_000, daysAgo: 35.5 }),
    ]);

    const trend = await collectionTrend(admin, 6);
    expect(trend).toHaveLength(6);
    // Oldest first, newest month last: this month's money lands in the last
    // point, the 35-day-old payments net of the reversal one month back.
    expect(trend[5].minor).toBe(4_500_000);
    expect([trend[3].minor, trend[4].minor]).toContain(2_000_000 - 500_000);
  });
});

describe("income reports", () => {
  it("groups by channel and property within the window", async () => {
    await seedPortfolio();
    await Promise.all([
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 4_500_000, daysAgo: 1 }),
      seedPayment({ propertyId: "prop_1", provider: "mpesa", status: "allocated", amountMinor: 1_500_000, daysAgo: 2 }),
      seedPayment({ propertyId: "prop_2", provider: "bank", status: "allocated", amountMinor: 3_000_000, daysAgo: 2 }),
    ]);

    const channels = await incomeByChannel(admin, stamp(10), new Date(stubNow + DAY));
    expect(channels).toEqual([
      expect.objectContaining({ label: "M-Pesa", minor: 6_000_000 }),
      expect.objectContaining({ label: "Bank", minor: 3_000_000 }),
    ]);
    // Sorted descending by money.

    const properties = await incomeByProperty(admin, stamp(10), new Date(stubNow + DAY));
    expect(properties[0].label).toBe("Kileleshwa Apartments");
    expect(properties[0].minor).toBe(6_000_000);

    const months = await incomeByMonth(admin, stamp(10), new Date(stubNow + DAY));
    const monthTotal = months.reduce((sum, point) => sum + point.minor, 0);
    expect(monthTotal).toBe(4_500_000 + 1_500_000 + 3_000_000);
  });
});

describe("arrearsAging", () => {
  it("buckets live balances by days past due", async () => {
    await seedPortfolio();
    await Promise.all([
      seedInvoice(-10, { balanceMinor: 4_500_000 }),
      seedInvoice(-45, { status: "partial", balanceMinor: 2_000_000 }),
      seedInvoice(5, { balanceMinor: 500_000 }), // not yet due
    ]);

    const buckets = await arrearsAging(admin);
    expect(buckets.find((bucket) => bucket.label === "1–30 days")).toMatchObject({
      minor: 4_500_000,
      invoices: 1,
    });
    expect(buckets.find((bucket) => bucket.label === "31–60 days")).toMatchObject({
      minor: 2_000_000,
      invoices: 1,
    });
    expect(buckets.find((bucket) => bucket.label === "Not yet due")).toMatchObject({
      minor: 500_000,
      invoices: 1,
    });
  });
});

describe("export row builders", () => {
  it("decorates payments with tenant and property names", async () => {
    await seedPortfolio();
    await seedPayment({
      propertyId: "prop_1",
      provider: "mpesa",
      status: "allocated",
      amountMinor: 4_500_000,
      daysAgo: 1,
      tenantId: "tnt_1",
      reference: "QGH7X2QK81",
    });

    const rows = await paymentsForExport(admin, stamp(10), new Date(stubNow + DAY));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference: "QGH7X2QK81",
      provider: "M-Pesa",
      tenant: "Grace Wanjiru",
      property: "Kileleshwa Apartments",
      status: "allocated",
      amountMinor: 4_500_000,
    });
  });

  it("lists live arrears with names, oldest due first", async () => {
    await seedPortfolio();
    await Promise.all([
      seedInvoice(-45, { status: "partial", balanceMinor: 1_000_000 }),
      seedInvoice(-10, { balanceMinor: 4_500_000 }),
      seedInvoice(0, { status: "paid", balanceMinor: 0 }),
    ]);

    const rows = await arrearsForExport(admin);
    expect(rows).toHaveLength(2);
    expect(rows[0].tenant).toBe("Grace Wanjiru");
    expect(rows[0].property).toBe("Kileleshwa Apartments");
    expect(rows[0].unit).toBe("UNIT_1");
    // oldest due date first
    expect(rows[0].balanceMinor).toBe(1_000_000);
  });
});
