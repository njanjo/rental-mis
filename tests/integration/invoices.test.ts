import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { parseDateInput } from "@/lib/dates";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import {
  generateInvoices,
  getInvoice,
  listInvoices,
  voidInvoice,
} from "@/services/invoices";

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
const auditor = actor("auditor");

function date(value: string): Date {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`bad date ${value}`);
  return parsed;
}

function stamp(value: string): Timestamp {
  return Timestamp.fromDate(date(value));
}

async function seedUser(user: SessionUser, overrides: Record<string, unknown> = {}) {
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
      ...overrides,
    });
}

async function seedProperty(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("properties")
    .doc(id)
    .set({
      name: id === "prop_1" ? "Kilimani Heights" : id,
      nameLower: id.toLowerCase(),
      address: "Test address",
      county: "Nairobi",
      managerIds: [],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function seedUnit(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("units")
    .doc(id)
    .set({
      propertyId: "prop_1",
      unitNumber: id.toUpperCase(),
      rentAmountMinor: 4_500_000,
      depositAmountMinor: 9_000_000,
      currency: "KES",
      status: "occupied",
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function seedTenant(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("tenants")
    .doc(id)
    .set({
      fullName: "Grace Wanjiru",
      phoneE164: "+254712345678",
      nationalIdLast4: "1234",
      status: "active",
      consentSms: true,
      propertyIds: ["prop_1"],
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function seedLease(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("leases")
    .doc(id)
    .set({
      tenantId: "tnt_1",
      unitId: "unit_1",
      propertyId: "prop_1",
      startDate: stamp("2025-01-01"),
      endDate: stamp("2026-12-31"),
      rentAmountMinor: 4_500_000,
      currency: "KES",
      dueDay: 5,
      depositAmountMinor: 9_000_000,
      status: "active",
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

interface SeedInvoiceOptions {
  leaseId?: string;
  tenantId?: string;
  unitId?: string;
  propertyId?: string;
  periodKey?: string;
  dueDate?: string;
  amountDueMinor?: number;
  amountPaidMinor?: number;
  status?: string;
  billableDays?: number;
  periodDays?: number;
}

async function seedInvoice(
  id: string,
  overrides: SeedInvoiceOptions = {},
): Promise<void> {
  const amountDueMinor = overrides.amountDueMinor ?? 4_500_000;
  const amountPaidMinor = overrides.amountPaidMinor ?? 0;
  await db()
    .collection("invoices")
    .doc(id)
    .set({
      leaseId: overrides.leaseId ?? "lease_1",
      tenantId: overrides.tenantId ?? "tnt_1",
      unitId: overrides.unitId ?? "unit_1",
      propertyId: overrides.propertyId ?? "prop_1",
      periodKey: overrides.periodKey ?? "2026-01",
      dueDate: stamp(overrides.dueDate ?? "2026-01-05"),
      amountDueMinor,
      amountPaidMinor,
      balanceMinor: amountDueMinor - amountPaidMinor,
      currency: "KES",
      status: overrides.status ?? "open",
      ...(overrides.billableDays !== undefined
        ? { billableDays: overrides.billableDays }
        : {}),
      ...(overrides.periodDays !== undefined
        ? { periodDays: overrides.periodDays }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function invoiceData(id: string) {
  return (await db().collection("invoices").doc(id).get()).data();
}

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

async function seedPortfolio(): Promise<void> {
  await seedUser(admin);
  await seedUser(manager);
  await seedUser(otherManager);
  await seedUser(finance);
  await seedUser(otherFinance);
  await seedUser(auditor);
  await seedProperty("prop_1");
  await seedProperty("prop_2");
  await seedTenant("tnt_1");
  await seedUnit("unit_1");
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

describe("generateInvoices", () => {
  async function seedBillableLeases(): Promise<void> {
    await seedPortfolio();
    await seedUnit("unit_prorate");
    await seedUnit("unit_end");
    await seedUnit("unit_future");
    await seedUnit("unit_pending");
    await seedUnit("unit_other", { propertyId: "prop_2" });
    await seedTenant("tnt_2", { fullName: "Peter Otieno" });

    await seedLease("lease_full");
    await seedLease("lease_prorate", {
      unitId: "unit_prorate",
      startDate: stamp("2026-03-11"),
    });
    await seedLease("lease_end", {
      unitId: "unit_end",
      tenantId: "tnt_2",
      endDate: stamp("2026-03-10"),
      dueDay: 31,
    });
    await seedLease("lease_future", {
      unitId: "unit_future",
      startDate: stamp("2026-04-01"),
    });
    await seedLease("lease_pending", {
      unitId: "unit_pending",
      status: "pending",
    });
    await seedLease("lease_other", {
      unitId: "unit_other",
      propertyId: "prop_2",
      tenantId: "tnt_2",
    });
  }

  it("creates one prorated invoice per active lease and audits each", async () => {
    await seedBillableLeases();

    const result = await generateInvoices(admin, { period: "2026-03" });
    expect(result).toEqual({ periodKey: "2026-03", created: 4, skipped: 0, total: 4 });

    const full = await invoiceData("lease_full_2026-03");
    expect(full?.amountDueMinor).toBe(4_500_000);
    expect(full?.balanceMinor).toBe(4_500_000);
    expect(full?.status).toBe("open");
    expect(full?.unitId).toBe("unit_1");
    expect(full?.propertyId).toBe("prop_1");
    expect(full?.billableDays).toBe(31);
    expect(full?.periodDays).toBe(31);
    expect(full?.dueDate.toDate().toISOString()).toBe(date("2026-03-05").toISOString());

    const prorated = await invoiceData("lease_prorate_2026-03");
    expect(prorated?.billableDays).toBe(21);
    expect(prorated?.amountDueMinor).toBe(3_048_387);

    const ending = await invoiceData("lease_end_2026-03");
    expect(ending?.billableDays).toBe(10);
    expect(ending?.amountDueMinor).toBe(1_451_613);
    expect(ending?.dueDate.toDate().toISOString()).toBe(
      date("2026-03-31").toISOString(),
    );

    // No overlap, pending status and other properties are all handled.
    expect(await invoiceData("lease_future_2026-03")).toBeUndefined();
    expect(await invoiceData("lease_pending_2026-03")).toBeUndefined();
    expect(await invoiceData("lease_other_2026-03")).toBeTruthy();

    expect(await auditActions("lease_full_2026-03")).toContain(
      "invoice.generated",
    );
  });

  it("is idempotent and never rewrites issued invoices", async () => {
    await seedBillableLeases();

    await generateInvoices(admin, { period: "2026-03" });
    await db()
      .collection("invoices")
      .doc("lease_full_2026-03")
      .update({ amountDueMinor: 1, balanceMinor: 1 });

    const second = await generateInvoices(admin, { period: "2026-03" });
    expect(second).toEqual({ periodKey: "2026-03", created: 0, skipped: 4, total: 4 });
    expect((await invoiceData("lease_full_2026-03"))?.amountDueMinor).toBe(1);
  });

  it("never recreates a voided invoice", async () => {
    await seedBillableLeases();
    await generateInvoices(admin, { period: "2026-03" });
    await voidInvoice(admin, "lease_prorate_2026-03", "Raised by mistake");

    const second = await generateInvoices(admin, { period: "2026-03" });
    expect(second.created).toBe(0);
    expect((await invoiceData("lease_prorate_2026-03"))?.status).toBe("void");
  });

  it("limits generation to the caller's property scope", async () => {
    await seedBillableLeases();

    const scoped = await generateInvoices(finance, { period: "2026-03" });
    expect(scoped.created).toBe(3);
    expect(await invoiceData("lease_other_2026-03")).toBeUndefined();
    expect(await invoiceData("lease_full_2026-03")).toBeTruthy();

    const other = await generateInvoices(otherFinance, { period: "2026-03" });
    expect(other.created).toBe(1);
    expect(await invoiceData("lease_other_2026-03")).toBeTruthy();
  });

  it("refuses roles without manage_invoices and invalid periods", async () => {
    await seedBillableLeases();

    await expect(
      generateInvoices(manager, { period: "2026-03" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      generateInvoices(auditor, { period: "2026-03" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      generateInvoices(admin, { period: "2026-13" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("skips a period where every lease is outside the ranges", async () => {
    await seedPortfolio();

    const result = await generateInvoices(admin, { period: "2024-05" });
    expect(result).toEqual({ periodKey: "2024-05", created: 0, skipped: 0, total: 0 });
  });
});

describe("invoice queries", () => {
  async function seedInvoices(): Promise<void> {
    await seedPortfolio();
    await seedUnit("unit_2", { propertyId: "prop_2" });
    await seedTenant("tnt_2", { fullName: "Peter Otieno" });

    await seedInvoice("inv_old", {
      periodKey: "2026-01",
      dueDate: "2026-01-05",
    });
    await seedInvoice("inv_partial", {
      periodKey: "2026-02",
      dueDate: "2026-02-05",
      amountPaidMinor: 1_500_000,
      status: "partial",
    });
    await seedInvoice("inv_paid", {
      periodKey: "2026-02",
      dueDate: "2026-02-25",
      amountPaidMinor: 4_500_000,
      status: "paid",
    });
    await seedInvoice("inv_future", {
      periodKey: "2026-12",
      dueDate: "2026-12-05",
    });
    await seedInvoice("inv_other", {
      propertyId: "prop_2",
      unitId: "unit_2",
      tenantId: "tnt_2",
      periodKey: "2026-02",
      dueDate: "2026-02-10",
    });
  }

  it("scopes lists to properties and orders by due date", async () => {
    await seedInvoices();

    const all = await listInvoices(admin, {});
    expect(all.items.map((invoice) => invoice.id)).toEqual([
      "inv_future",
      "inv_paid",
      "inv_other",
      "inv_partial",
      "inv_old",
    ]);

    const scoped = await listInvoices(manager, {});
    expect(scoped.items.map((invoice) => invoice.id)).toEqual([
      "inv_future",
      "inv_paid",
      "inv_partial",
      "inv_old",
    ]);

    const other = await listInvoices(otherManager, {});
    expect(other.items.map((invoice) => invoice.id)).toEqual(["inv_other"]);

    await expect(
      listInvoices(manager, { propertyId: "prop_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("derives overdue and filters by status and period", async () => {
    await seedInvoices();

    const overdue = await listInvoices(manager, { status: "overdue" });
    expect(overdue.items.map((invoice) => invoice.id).sort()).toEqual([
      "inv_old",
      "inv_partial",
    ]);
    expect(overdue.items.every((invoice) => invoice.isOverdue)).toBe(true);

    const partial = await listInvoices(manager, { status: "partial" });
    expect(partial.items.map((invoice) => invoice.id)).toEqual(["inv_partial"]);
    expect(partial.items[0]?.storedStatus).toBe("partial");
    expect(partial.items[0]?.status).toBe("overdue");
    expect(partial.items[0]?.isOverdue).toBe(true);

    const february = await listInvoices(manager, { periodKey: "2026-02" });
    expect(february.items.map((invoice) => invoice.id)).toEqual([
      "inv_paid",
      "inv_partial",
    ]);

    const paid = await listInvoices(manager, { status: "paid" });
    expect(paid.items.map((invoice) => invoice.id)).toEqual(["inv_paid"]);
  });

  it("searches tenant, unit, property, period and phone", async () => {
    await seedInvoices();

    expect((await listInvoices(manager, { q: "wanjiru" })).items).toHaveLength(4);
    expect((await listInvoices(manager, { q: "kilimani" })).items).toHaveLength(4);
    expect((await listInvoices(manager, { q: "2026-02" })).items).toHaveLength(2);
    expect((await listInvoices(manager, { q: "february" })).items).toHaveLength(2);
    expect((await listInvoices(manager, { q: "0712345678" })).items).toHaveLength(4);
    expect((await listInvoices(manager, { q: "nothing" })).items).toHaveLength(0);
  });

  it("paginates with a cursor", async () => {
    await seedInvoices();

    const first = await listInvoices(admin, { pageSize: 2 });
    expect(first.items.map((invoice) => invoice.id)).toEqual([
      "inv_future",
      "inv_paid",
    ]);
    expect(first.nextCursor).toBe("inv_paid");

    const second = await listInvoices(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((invoice) => invoice.id)).toEqual([
      "inv_other",
      "inv_partial",
    ]);
    expect(second.nextCursor).toBe("inv_partial");

    const third = await listInvoices(admin, {
      pageSize: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.items.map((invoice) => invoice.id)).toEqual(["inv_old"]);
    expect(third.nextCursor).toBeNull();
  });

  it("decorates details with tenant, unit, property and allocations", async () => {
    await seedInvoices();
    await db()
      .collection("payments")
      .doc("pay_1")
      .set({
        provider: "mpesa",
        providerTransactionId: "SJK4AB12XY",
        amountMinor: 1_500_000,
        currency: "KES",
        tenantId: "tnt_1",
        leaseId: "lease_1",
        status: "confirmed",
        receivedAt: stamp("2026-02-06"),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    await db()
      .collection("paymentAllocations")
      .doc("alloc_1")
      .set({
        paymentId: "pay_1",
        invoiceId: "inv_partial",
        amountMinor: 1_500_000,
        createdBy: "uid_finance",
        createdAt: FieldValue.serverTimestamp(),
      });

    const invoice = await getInvoice(manager, "inv_partial");
    expect(invoice.tenantName).toBe("Grace Wanjiru");
    expect(invoice.tenantPhone).toBe("+254712345678");
    expect(invoice.unitNumber).toBe("UNIT_1");
    expect(invoice.propertyName).toBe("Kilimani Heights");
    expect(invoice.periodLabel).toBe("February 2026");
    expect(invoice.allocations).toHaveLength(1);
    expect(invoice.allocations[0]).toMatchObject({
      paymentId: "pay_1",
      amountMinor: 1_500_000,
      provider: "mpesa",
      providerTransactionId: "SJK4AB12XY",
    });

    await expect(getInvoice(manager, "inv_missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getInvoice(manager, "inv_other")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getInvoice(manager, "inv_partial")).resolves.toBeTruthy();
  });
});

describe("voidInvoice", () => {
  it("voids an unpaid invoice with a reason and an audit trail", async () => {
    await seedPortfolio();
    await seedInvoice("inv_1");

    await voidInvoice(finance, "inv_1", "Duplicate invoice raised in error");

    const invoice = await invoiceData("inv_1");
    expect(invoice?.status).toBe("void");
    expect(invoice?.balanceMinor).toBe(0);
    expect(invoice?.voidReason).toBe("Duplicate invoice raised in error");
    expect(invoice?.voidedBy).toBe("uid_finance");
    expect(invoice?.voidedAt).toBeTruthy();
    expect(await auditActions("inv_1")).toContain("invoice.voided");
  });

  it("refuses a second void or an invoice with payments", async () => {
    await seedPortfolio();
    await seedInvoice("inv_void", { status: "void" });
    await seedInvoice("inv_paid", {
      status: "paid",
      amountPaidMinor: 4_500_000,
    });
    await seedInvoice("inv_partial", {
      status: "partial",
      amountPaidMinor: 1_000_000,
    });

    await expect(
      voidInvoice(admin, "inv_void", "Already void"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      voidInvoice(admin, "inv_paid", "Try to void a paid invoice"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      voidInvoice(admin, "inv_partial", "Try to void a part-paid invoice"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces capability, scope and not_found", async () => {
    await seedPortfolio();
    await seedInvoice("inv_1");
    await seedInvoice("inv_other", { propertyId: "prop_2" });

    await expect(
      voidInvoice(manager, "inv_1", "Managers cannot void"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      voidInvoice(auditor, "inv_1", "Auditors cannot void"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      voidInvoice(finance, "inv_other", "Out of scope"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      voidInvoice(admin, "inv_missing", "Missing invoice"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      voidInvoice(otherFinance, "inv_other", "In scope"),
    ).resolves.toBeUndefined();
    expect((await invoiceData("inv_other"))?.status).toBe("void");
  });
});
