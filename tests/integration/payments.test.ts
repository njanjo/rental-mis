import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { parseDateInput } from "@/lib/dates";
import { adminDb } from "@/lib/firebase/admin";
import { paymentIdForReference } from "@/lib/payments";
import type { Role } from "@/lib/types";
import {
  countOpenUnmatched,
  getPayment,
  ignoreUnmatched,
  listPayments,
  listUnmatched,
  recordManualReceipt,
  resolveUnmatched,
  reversePayment,
} from "@/services/payments";

const db = () => adminDb();

function actor(
  role: Role,
  propertyIds: string[] = [],
  uid = `uid_${role}`,
): SessionUser {
  return {
    uid,
    email: `${uid}@rentalmis.test`,
    fullName: uid,
    role,
    active: true,
    propertyIds,
  };
}

const admin = actor("admin");
const manager = actor("property_manager", ["prop_1"], "uid_manager");
const otherManager = actor("property_manager", ["prop_2"], "uid_other_manager");
const finance = actor("finance", ["prop_1"], "uid_finance");
const otherFinance = actor("finance", ["prop_2"], "uid_other_finance");
const maintenance = actor("maintenance", ["prop_1"], "uid_maintenance");
const auditor = actor("auditor");

function date(value: string): Date {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`bad date ${value}`);
  return parsed;
}

function stamp(value: string): Timestamp {
  return Timestamp.fromDate(date(value));
}

async function seedUser(user: SessionUser): Promise<void> {
  await db()
    .collection("users")
    .doc(user.uid)
    .set({
      uid: user.uid,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      propertyIds: user.propertyIds,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedProperty(id: string, name: string): Promise<void> {
  await db()
    .collection("properties")
    .doc(id)
    .set({
      name,
      nameLower: name.toLowerCase(),
      address: "Test address",
      county: "Nairobi",
      managerIds: [],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedUnit(id: string, propertyId: string): Promise<void> {
  await db()
    .collection("units")
    .doc(id)
    .set({
      propertyId,
      unitNumber: id.toUpperCase(),
      rentAmountMinor: 4_500_000,
      depositAmountMinor: 9_000_000,
      currency: "KES",
      status: "occupied",
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

interface SeedTenantOptions {
  fullName?: string;
  phoneE164?: string;
  propertyId?: string;
  unitId?: string;
  leaseId?: string;
  creditBalanceMinor?: number;
}

async function seedTenant(
  id: string,
  options: SeedTenantOptions = {},
): Promise<void> {
  const propertyId = options.propertyId ?? "prop_1";
  await db()
    .collection("tenants")
    .doc(id)
    .set({
      fullName: options.fullName ?? "Grace Wanjiru",
      fullNameLower: (options.fullName ?? "Grace Wanjiru").toLowerCase(),
      phoneE164: options.phoneE164 ?? "+254712345678",
      nationalIdLast4: "1234",
      status: "active",
      consentSms: true,
      propertyIds: [propertyId],
      currentPropertyId: propertyId,
      ...(options.unitId ? { currentUnitId: options.unitId } : {}),
      ...(options.leaseId ? { currentLeaseId: options.leaseId } : {}),
      ...(options.creditBalanceMinor !== undefined
        ? { creditBalanceMinor: options.creditBalanceMinor }
        : {}),
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedLease(
  id: string,
  tenantId: string,
  unitId: string,
  propertyId: string,
): Promise<void> {
  await db()
    .collection("leases")
    .doc(id)
    .set({
      tenantId,
      unitId,
      propertyId,
      startDate: stamp("2025-01-01"),
      endDate: stamp("2026-12-31"),
      rentAmountMinor: 4_500_000,
      currency: "KES",
      dueDay: 5,
      depositAmountMinor: 9_000_000,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

interface SeedInvoiceOptions {
  tenantId?: string;
  leaseId?: string;
  unitId?: string;
  propertyId?: string;
  periodKey?: string;
  dueDate?: string;
  amountDueMinor?: number;
  amountPaidMinor?: number;
  status?: string;
}

async function seedInvoice(
  id: string,
  options: SeedInvoiceOptions = {},
): Promise<void> {
  const amountDueMinor = options.amountDueMinor ?? 4_500_000;
  const amountPaidMinor = options.amountPaidMinor ?? 0;
  await db()
    .collection("invoices")
    .doc(id)
    .set({
      tenantId: options.tenantId ?? "tnt_1",
      leaseId: options.leaseId ?? "lease_1",
      unitId: options.unitId ?? "unit_1",
      propertyId: options.propertyId ?? "prop_1",
      periodKey: options.periodKey ?? "2026-01",
      dueDate: stamp(options.dueDate ?? "2026-01-05"),
      amountDueMinor,
      amountPaidMinor,
      balanceMinor: amountDueMinor - amountPaidMinor,
      currency: "KES",
      status: options.status ?? "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedPayment(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("payments")
    .doc(id)
    .set({
      provider: "mpesa",
      providerTransactionId: id.toUpperCase(),
      amountMinor: 1_000_000,
      currency: "KES",
      status: "allocated",
      source: "manual",
      receivedAt: stamp("2026-01-10"),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function seedUnmatchedRow(
  id: string,
  paymentId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("unmatchedPayments")
    .doc(id)
    .set({
      paymentId,
      candidateTenantIds: [],
      reason: "No reliable tenant match",
      reviewStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function paymentData(id: string) {
  return (await db().collection("payments").doc(id).get()).data();
}

async function tenantData(id: string) {
  return (await db().collection("tenants").doc(id).get()).data();
}

async function invoiceData(id: string) {
  return (await db().collection("invoices").doc(id).get()).data();
}

async function allocationDocs(paymentId: string) {
  const snapshot = await db()
    .collection("paymentAllocations")
    .where("paymentId", "==", paymentId)
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

const receipt = {
  tenantId: "tnt_1",
  amount: 6_000_000,
  provider: "mpesa" as const,
  providerTransactionId: "SJK4AB12XY",
  receivedAt: date("2026-02-06"),
  payerName: "GRACE WANJIRU",
  payerPhone: "+254712345678",
  narration: "Monthly rent",
  bankCode: undefined,
};

async function seedPortfolio(): Promise<void> {
  await seedUser(admin);
  await seedUser(manager);
  await seedUser(otherManager);
  await seedUser(finance);
  await seedUser(otherFinance);
  await seedUser(maintenance);
  await seedUser(auditor);

  await seedProperty("prop_1", "Kilimani Heights");
  await seedProperty("prop_2", "Westlands Court");
  await seedUnit("unit_1", "prop_1");
  await seedUnit("unit_2", "prop_2");

  await seedTenant("tnt_1", {
    unitId: "unit_1",
    leaseId: "lease_1",
  });
  await seedTenant("tnt_2", {
    fullName: "Peter Otieno",
    phoneE164: "+254723456789",
    propertyId: "prop_2",
    unitId: "unit_2",
    leaseId: "lease_2",
  });

  await seedLease("lease_1", "tnt_1", "unit_1", "prop_1");
  await seedLease("lease_2", "tnt_2", "unit_2", "prop_2");

  await seedInvoice("inv_jan", {
    periodKey: "2026-01",
    dueDate: "2026-01-05",
  });
  await seedInvoice("inv_feb", {
    periodKey: "2026-02",
    dueDate: "2026-02-05",
  });
}

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    [
      "properties",
      "units",
      "tenants",
      "tenantPhones",
      "leases",
      "invoices",
      "payments",
      "paymentAllocations",
      "unmatchedPayments",
      "auditLogs",
      "users",
    ].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );
});

describe("recordManualReceipt", () => {
  it("records a receipt and allocates it oldest-due first", async () => {
    await seedPortfolio();

    const paymentId = await recordManualReceipt(finance, receipt);

    expect(paymentId).toBe(paymentIdForReference("mpesa", "SJK4AB12XY"));
    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({
      provider: "mpesa",
      providerTransactionId: "SJK4AB12XY",
      amountMinor: 6_000_000,
      tenantId: "tnt_1",
      leaseId: "lease_1",
      propertyId: "prop_1",
      status: "allocated",
      source: "manual",
      allocatedMinor: 6_000_000,
      creditAddedMinor: 0,
      payerName: "GRACE WANJIRU",
      payerPhone: "+254712345678",
      confirmedBy: "uid_finance",
    });
    expect(payment?.confirmedAt).toBeTruthy();

    const january = await invoiceData("inv_jan");
    expect(january).toMatchObject({
      amountPaidMinor: 4_500_000,
      balanceMinor: 0,
      status: "paid",
    });
    const february = await invoiceData("inv_feb");
    expect(february).toMatchObject({
      amountPaidMinor: 1_500_000,
      balanceMinor: 3_000_000,
      status: "partial",
    });

    const allocations = await allocationDocs(paymentId);
    expect(
      allocations.map((row) => [row.invoiceId, row.amountMinor]).sort(),
    ).toEqual([
      ["inv_feb", 1_500_000],
      ["inv_jan", 4_500_000],
    ]);
    expect(await auditActions(paymentId)).toEqual(
      expect.arrayContaining(["payment.recorded", "payment.allocated"]),
    );

    const detail = await getPayment(finance, paymentId);
    expect(detail.tenantName).toBe("Grace Wanjiru");
    expect(detail.propertyName).toBe("Kilimani Heights");
    expect(detail.allocations.map((line) => line.invoiceId)).toEqual([
      "inv_jan",
      "inv_feb",
    ]);
    expect(detail.allocations[0]?.periodLabel).toBe("January 2026");
  });

  it("rejects a duplicate reference regardless of case or spacing", async () => {
    await seedPortfolio();

    const first = await recordManualReceipt(finance, receipt);
    await expect(
      recordManualReceipt(finance, {
        ...receipt,
        providerTransactionId: "  sjk4ab12xy ",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const snapshot = await db().collection("payments").get();
    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0]?.id).toBe(first);
    expect(await invoiceData("inv_jan")).toMatchObject({
      amountPaidMinor: 4_500_000,
    });
  });

  it("turns an overpayment into tenant credit", async () => {
    await seedPortfolio();

    const paymentId = await recordManualReceipt(finance, {
      ...receipt,
      amount: 9_500_000,
    });

    expect(await paymentData(paymentId)).toMatchObject({
      amountMinor: 9_500_000,
      allocatedMinor: 9_000_000,
      creditAddedMinor: 500_000,
    });
    expect((await tenantData("tnt_1"))?.creditBalanceMinor).toBe(500_000);
    expect(await invoiceData("inv_jan")).toMatchObject({
      status: "paid",
      balanceMinor: 0,
    });
    expect(await auditActions("tnt_1")).toContain("tenant.credit_added");
  });

  it("generates a reference for a cash receipt", async () => {
    await seedPortfolio();

    const paymentId = await recordManualReceipt(finance, {
      ...receipt,
      provider: "manual",
      providerTransactionId: undefined,
      amount: 1_000_000,
    });

    const payment = await paymentData(paymentId);
    expect(payment?.provider).toBe("manual");
    expect(payment?.providerTransactionId).toMatch(/^MAN-\d{8}-[A-Z0-9]{8}$/);
    expect(await invoiceData("inv_jan")).toMatchObject({
      amountPaidMinor: 1_000_000,
      balanceMinor: 3_500_000,
      status: "partial",
    });
  });

  it("requires a reference for provider money", async () => {
    await seedPortfolio();

    await expect(
      recordManualReceipt(finance, {
        ...receipt,
        providerTransactionId: undefined,
      }),
    ).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { providerTransactionId: expect.any(Array) },
    });
  });

  it("enforces capabilities and tenant property scope", async () => {
    await seedPortfolio();

    await expect(
      recordManualReceipt(manager, receipt),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      recordManualReceipt(auditor, receipt),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      recordManualReceipt(finance, {
        ...receipt,
        tenantId: "tnt_2",
        payerPhone: "+254723456789",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      recordManualReceipt(otherFinance, {
        ...receipt,
        tenantId: "tnt_2",
        payerPhone: "+254723456789",
      }),
    ).resolves.toBeTruthy();
  });
});

describe("reversePayment", () => {
  it("appends compensating entries and restores invoice balances", async () => {
    await seedPortfolio();
    const paymentId = await recordManualReceipt(finance, receipt);

    const reversalId = await reversePayment(
      admin,
      paymentId,
      "Cheque returned by bank",
    );

    expect(reversalId).toBe(`rev_${paymentId}`);
    expect(await paymentData(paymentId)).toMatchObject({
      status: "reversed",
      reversalReason: "Cheque returned by bank",
      reversedBy: "uid_admin",
    });
    expect((await paymentData(paymentId))?.reversedAt).toBeTruthy();

    const reversal = await paymentData(reversalId);
    expect(reversal).toMatchObject({
      provider: "mpesa",
      providerTransactionId: "REV-SJK4AB12XY",
      amountMinor: -6_000_000,
      status: "reversal",
      allocatedMinor: -6_000_000,
      creditAddedMinor: 0,
      reversalOfPaymentId: paymentId,
      propertyId: "prop_1",
      tenantId: "tnt_1",
    });

    expect(await invoiceData("inv_jan")).toMatchObject({
      amountPaidMinor: 0,
      balanceMinor: 4_500_000,
      status: "open",
    });
    expect(await invoiceData("inv_feb")).toMatchObject({
      amountPaidMinor: 0,
      balanceMinor: 4_500_000,
      status: "open",
    });

    // The original allocation rows are untouched; the reversal adds new ones.
    const original = await allocationDocs(paymentId);
    expect(original).toHaveLength(2);
    const compensating = await allocationDocs(reversalId);
    expect(
      compensating.map((row) => [row.invoiceId, row.amountMinor]).sort(),
    ).toEqual([
      ["inv_feb", -1_500_000],
      ["inv_jan", -4_500_000],
    ]);

    expect(await auditActions(paymentId)).toContain("payment.reversed");
    const detail = await getPayment(admin, paymentId);
    expect(detail.status).toBe("reversed");
    expect(detail.reversalPaymentId).toBe(reversalId);
  });

  it("removes untouched credit and blocks a second reversal", async () => {
    await seedPortfolio();
    const paymentId = await recordManualReceipt(finance, {
      ...receipt,
      amount: 9_500_000,
    });

    await reversePayment(admin, paymentId, "Payment was duplicated");

    expect((await tenantData("tnt_1"))?.creditBalanceMinor).toBe(0);
    expect(await auditActions("tnt_1")).toContain("tenant.credit_reversed");

    await expect(
      reversePayment(admin, paymentId, "Trying again"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to reverse when overpayment credit has already been used", async () => {
    await seedPortfolio();
    const paymentId = await recordManualReceipt(finance, {
      ...receipt,
      amount: 9_500_000,
    });

    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ creditBalanceMinor: 0 });

    await expect(
      reversePayment(admin, paymentId, "Bank returned the funds"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("is limited to admins and never reverses an unallocated payment", async () => {
    await seedPortfolio();
    const paymentId = await recordManualReceipt(finance, receipt);

    await expect(
      reversePayment(finance, paymentId, "Finance cannot reverse"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      reversePayment(manager, paymentId, "Manager cannot reverse"),
    ).rejects.toMatchObject({ code: "forbidden" });

    await seedPayment("pay_queue", { status: "unmatched" });
    await expect(
      reversePayment(admin, "pay_queue", "No allocation to reverse"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("payment queries", () => {
  async function seedPayments(): Promise<void> {
    await seedPortfolio();
    await seedPayment("pay_a", {
      tenantId: "tnt_1",
      propertyId: "prop_1",
      provider: "mpesa",
      providerTransactionId: "AAA111",
      status: "allocated",
      receivedAt: stamp("2026-01-03"),
    });
    await seedPayment("pay_b", {
      tenantId: "tnt_1",
      propertyId: "prop_1",
      provider: "bank",
      providerTransactionId: "BBB222",
      status: "allocated",
      payerName: "Grace Wanjiru",
      receivedAt: stamp("2026-01-02"),
    });
    await seedPayment("pay_c", {
      tenantId: "tnt_2",
      propertyId: "prop_2",
      provider: "mpesa",
      providerTransactionId: "CCC333",
      status: "unmatched",
      receivedAt: stamp("2026-01-01"),
    });
  }

  it("scopes lists by property and orders newest first", async () => {
    await seedPayments();

    const all = await listPayments(admin, {});
    expect(all.items.map((row) => row.id)).toEqual(["pay_a", "pay_b", "pay_c"]);

    const scoped = await listPayments(manager, {});
    expect(scoped.items.map((row) => row.id)).toEqual(["pay_a", "pay_b"]);

    const other = await listPayments(otherManager, {});
    expect(other.items.map((row) => row.id)).toEqual(["pay_c"]);

    await expect(
      listPayments(manager, { propertyId: "prop_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPayments(maintenance, {})).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listPayments(auditor, {})).resolves.toBeTruthy();
  });

  it("filters status, provider and free text over the recent window", async () => {
    await seedPayments();

    const unmatched = await listPayments(admin, { status: "unmatched" });
    expect(unmatched.items.map((row) => row.id)).toEqual(["pay_c"]);
    expect(unmatched.nextCursor).toBeNull();

    const bank = await listPayments(admin, { provider: "bank" });
    expect(bank.items.map((row) => row.id)).toEqual(["pay_b"]);

    const search = await listPayments(admin, { q: "bbb" });
    expect(search.items.map((row) => row.id)).toEqual(["pay_b"]);

    // Tenant names are denormalised onto both rows, so both match the tenant.
    const byTenant = await listPayments(admin, { q: "grace" });
    expect(byTenant.items.map((row) => row.id)).toEqual(["pay_a", "pay_b"]);
  });

  it("paginates with a cursor", async () => {
    await seedPayments();

    const first = await listPayments(admin, { pageSize: 2 });
    expect(first.items.map((row) => row.id)).toEqual(["pay_a", "pay_b"]);
    expect(first.nextCursor).toBe("pay_b");

    const second = await listPayments(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((row) => row.id)).toEqual(["pay_c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("decorates details and hides unmatched payments from scoped users", async () => {
    await seedPayments();

    const detail = await getPayment(manager, "pay_b");
    expect(detail.tenantName).toBe("Grace Wanjiru");
    expect(detail.propertyName).toBe("Kilimani Heights");
    expect(detail.allocations).toEqual([]);

    await expect(getPayment(manager, "pay_c")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getPayment(admin, "pay_missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("unmatched queue", () => {
  async function seedQueue(): Promise<void> {
    await seedPortfolio();
    await seedPayment("pay_unknown", {
      amountMinor: 3_000_000,
      providerTransactionId: "QGR7X2M9KL",
      status: "unmatched",
      payerName: "JOHN DOE",
      payerPhone: "+254700000000",
      receivedAt: stamp("2026-02-07"),
    });
    await seedUnmatchedRow("unm_1", "pay_unknown", {
      reason: "Phone did not match an active tenant",
      candidateTenantIds: ["tnt_1", "tnt_2"],
    });
  }

  it("lists the shared queue for reconcilers only", async () => {
    await seedQueue();

    const rows = await listUnmatched(finance, {});
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({
      id: "unm_1",
      paymentId: "pay_unknown",
      amountMinor: 3_000_000,
      providerTransactionId: "QGR7X2M9KL",
      reason: "Phone did not match an active tenant",
      reviewStatus: "pending",
    });
    expect(rows.items[0]?.candidateTenantNames.sort()).toEqual([
      "Grace Wanjiru",
      "Peter Otieno",
    ]);

    // The queue is intentionally shared, so finance in another property sees it.
    await expect(listUnmatched(otherFinance, {})).resolves.toBeTruthy();
    await expect(listUnmatched(manager, {})).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(countOpenUnmatched(admin)).resolves.toBe(1);
  });

  it("matches to a tenant, allocates, and audits the decision", async () => {
    await seedQueue();

    const paymentId = await resolveUnmatched(finance, "unm_1", {
      tenantId: "tnt_1",
      note: "Tenant confirmed the M-Pesa message",
    });

    expect(paymentId).toBe("pay_unknown");
    expect(await paymentData("pay_unknown")).toMatchObject({
      status: "allocated",
      tenantId: "tnt_1",
      leaseId: "lease_1",
      propertyId: "prop_1",
      allocatedMinor: 3_000_000,
      creditAddedMinor: 0,
      confirmedBy: "uid_finance",
    });
    expect(await invoiceData("inv_jan")).toMatchObject({
      amountPaidMinor: 3_000_000,
      balanceMinor: 1_500_000,
      status: "partial",
    });

    const row = (
      await db().collection("unmatchedPayments").doc("unm_1").get()
    ).data();
    expect(row).toMatchObject({
      reviewStatus: "resolved",
      reviewedBy: "uid_finance",
      resolutionNote: "Tenant confirmed the M-Pesa message",
    });
    expect(await auditActions("unm_1")).toContain("unmatched.resolved");
    await expect(countOpenUnmatched(admin)).resolves.toBe(0);

    // It leaves the open queue but remains visible under "all".
    const open = await listUnmatched(admin, {});
    expect(open.items).toHaveLength(0);
    const all = await listUnmatched(admin, { status: "all" });
    expect(all.items.map((item) => item.id)).toEqual(["unm_1"]);
  });

  it("still enforces property scope when matching", async () => {
    await seedQueue();

    await expect(
      resolveUnmatched(finance, "unm_1", { tenantId: "tnt_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await paymentData("pay_unknown")).toMatchObject({
      status: "unmatched",
    });
    expect(
      (await db().collection("unmatchedPayments").doc("unm_1").get()).data()
        ?.reviewStatus,
    ).toBe("pending");
  });

  it("ignores a payment with a reason and refuses to reopen it", async () => {
    await seedQueue();

    await ignoreUnmatched(finance, "unm_1", {
      reason: "Bank reversed the transaction",
    });

    const row = (
      await db().collection("unmatchedPayments").doc("unm_1").get()
    ).data();
    expect(row).toMatchObject({
      reviewStatus: "ignored",
      reviewedBy: "uid_finance",
      resolutionNote: "Bank reversed the transaction",
    });
    expect(await auditActions("unm_1")).toContain("unmatched.ignored");
    expect(await paymentData("pay_unknown")).toMatchObject({
      status: "unmatched",
    });
    await expect(countOpenUnmatched(admin)).resolves.toBe(0);

    await expect(
      resolveUnmatched(finance, "unm_1", { tenantId: "tnt_1" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      ignoreUnmatched(finance, "unm_1", { reason: "Ignoring twice" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses an already-processed payment and missing rows", async () => {
    await seedQueue();
    await resolveUnmatched(admin, "unm_1", { tenantId: "tnt_1" });

    await expect(
      resolveUnmatched(admin, "unm_1", { tenantId: "tnt_1" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      resolveUnmatched(admin, "unm_missing", { tenantId: "tnt_1" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      ignoreUnmatched(admin, "unm_missing", { reason: "Missing row" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
