import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { parseDateInput } from "@/lib/dates";
import { adminDb } from "@/lib/firebase/admin";
import { paymentIdForReference } from "@/lib/payments";
import type { BankImportInput } from "@/lib/validation/bank-import";
import type { Role } from "@/lib/types";
import {
  commitBankStatement,
  listRecentBankImports,
  previewBankStatement,
} from "@/services/bank-import";

const db = () => adminDb();
const HEADER = "Date,Reference,Description,Credit,Debit,Phone";

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
const finance = actor("finance", ["prop_1"], "uid_finance");
const manager = actor("property_manager", ["prop_1"], "uid_manager");

function date(value: string): Date {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`bad date ${value}`);
  return parsed;
}

function stamp(value: string): Timestamp {
  return Timestamp.fromDate(date(value));
}

function statement(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

function input(csv: string, overrides: Partial<BankImportInput> = {}): BankImportInput {
  return {
    bankCode: "EQ",
    fileName: "equity-april.csv",
    csv,
    dateFormat: "auto",
    ...overrides,
  };
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
  status?: string;
  indexActive?: boolean;
}

async function seedTenant(
  id: string,
  options: SeedTenantOptions = {},
): Promise<void> {
  const propertyId = options.propertyId ?? "prop_1";
  const phone = options.phoneE164 ?? "+254712345678";

  await db()
    .collection("tenants")
    .doc(id)
    .set({
      fullName: options.fullName ?? "Grace Wanjiru",
      fullNameLower: (options.fullName ?? "Grace Wanjiru").toLowerCase(),
      phoneE164: phone,
      status: options.status ?? "active",
      consentSms: true,
      propertyIds: [propertyId],
      currentPropertyId: propertyId,
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await db()
    .collection("tenantPhones")
    .doc(phone)
    .set({
      tenantId: id,
      active: options.indexActive ?? true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedInvoice(
  id: string,
  tenantId: string,
  propertyId: string,
): Promise<void> {
  await db()
    .collection("invoices")
    .doc(id)
    .set({
      tenantId,
      leaseId: `lease_${tenantId}`,
      unitId: `unit_${tenantId}`,
      propertyId,
      periodKey: "2026-01",
      dueDate: stamp("2026-01-05"),
      amountDueMinor: 4_500_000,
      amountPaidMinor: 0,
      balanceMinor: 4_500_000,
      currency: "KES",
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedPortfolio(): Promise<void> {
  await seedProperty("prop_1", "Kilimani Heights");
  await seedProperty("prop_2", "Westlands Court");
  await seedUnit("unit_tnt_1", "prop_1");
  await seedUnit("unit_tnt_2", "prop_2");

  await seedTenant("tnt_1");
  await seedTenant("tnt_2", {
    fullName: "Peter Otieno",
    phoneE164: "+254723456789",
    propertyId: "prop_2",
  });
  await seedInvoice("inv_tnt_1", "tnt_1", "prop_1");
}

async function paymentData(id: string) {
  return (await db().collection("payments").doc(id).get()).data();
}

async function unmatchedData(id: string) {
  return (await db().collection("unmatchedPayments").doc(id).get()).data();
}

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

async function count(collection: string): Promise<number> {
  return (await db().collection(collection).get()).size;
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
      "bankSyncRuns",
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

describe("previewBankStatement", () => {
  it("matches an active tenant by phone without writing anything", async () => {
    await seedPortfolio();

    const preview = await previewBankStatement(
      admin,
      input(
        statement([
          "03/04/2026,EQ001,Rent,45000.00,,+254712345678",
          "04/04/2026,EQ002,Rent,45000.00,,+254799999999",
        ]),
      ),
    );

    expect(preview.totals).toMatchObject({
      dataRows: 2,
      matched: 1,
      unmatched: 1,
      duplicates: 0,
      errors: 0,
    });
    expect(preview.totals.amountMinor).toBe(9_000_000);
    expect(preview.rows[0]).toMatchObject({
      match: "tenant",
      tenantId: "tnt_1",
      tenantName: "Grace Wanjiru",
    });
    expect(preview.rows[1].reason).toContain("No active tenant");

    expect(await count("payments")).toBe(0);
    expect(await count("bankSyncRuns")).toBe(0);
  });

  it("marks a tenant outside the actor's properties as out of scope", async () => {
    await seedPortfolio();

    const preview = await previewBankStatement(
      finance,
      input(statement(["03/04/2026,EQ010,Rent,45000.00,,+254723456789"])),
    );

    expect(preview.rows[0].match).toBe("out_of_scope");
    expect(preview.rows[0].reason).toContain("outside the properties");
    expect(preview.totals.outOfScope).toBe(1);
  });

  it("queues a tenant that is no longer active", async () => {
    await seedPortfolio();
    await seedTenant("tnt_inactive", {
      fullName: "Former Tenant",
      phoneE164: "+254733333333",
      status: "inactive",
    });

    const preview = await previewBankStatement(
      admin,
      input(statement(["03/04/2026,EQ011,Rent,45000.00,,+254733333333"])),
    );

    expect(preview.rows[0].match).toBe("unmatched");
    expect(preview.rows[0].reason).toContain("inactive");
  });

  it("rejects staff who cannot reconcile payments", async () => {
    await seedPortfolio();
    await expect(
      previewBankStatement(
        manager,
        input(statement(["03/04/2026,EQ012,Rent,45000.00,,+254712345678"])),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("commitBankStatement", () => {
  it("imports a matched receipt, allocates it and records the run", async () => {
    await seedPortfolio();

    const result = await commitBankStatement(
      admin,
      input(statement(["03/04/2026,EQ001,Rent,45000.00,,+254712345678"])),
    );

    expect(result).toMatchObject({
      imported: 1,
      queued: 0,
      duplicates: 0,
      errors: 0,
    });

    const paymentId = paymentIdForReference("bank", "EQ001");
    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({
      provider: "bank",
      providerTransactionId: "EQ001",
      amountMinor: 4_500_000,
      tenantId: "tnt_1",
      propertyId: "prop_1",
      status: "allocated",
      source: "statement",
      bankCode: "EQ",
      allocatedMinor: 4_500_000,
      creditAddedMinor: 0,
    });

    const invoice = (await db().collection("invoices").doc("inv_tnt_1").get()).data();
    expect(invoice).toMatchObject({
      amountPaidMinor: 4_500_000,
      balanceMinor: 0,
      status: "paid",
    });

    const run = (await db().collection("bankSyncRuns").doc(result.runId).get()).data();
    expect(run).toMatchObject({
      bankCode: "EQ",
      fileName: "equity-april.csv",
      source: "statement",
      status: "succeeded",
      counts: {
        fetched: 1,
        imported: 1,
        queued: 0,
        duplicates: 0,
        errors: 0,
        skipped: 0,
      },
    });

    expect(await auditActions(paymentId)).toContain("payment.imported");
    expect(await auditActions(result.runId)).toContain("bank_import.committed");
  });

  it("queues an unknown phone without guessing a tenant", async () => {
    await seedPortfolio();

    const result = await commitBankStatement(
      admin,
      input(statement(["03/04/2026,EQ002,Rent,45000.00,,+254799999999"])),
    );

    expect(result.queued).toBe(1);
    const paymentId = paymentIdForReference("bank", "EQ002");
    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({ status: "unmatched", source: "statement" });
    expect(payment?.tenantId).toBeUndefined();
    expect(payment?.propertyId).toBeUndefined();

    const queued = await unmatchedData(`unm_${paymentId}`);
    expect(queued).toMatchObject({
      paymentId,
      reviewStatus: "pending",
    });
    expect(queued?.reason).toContain("No active tenant");
    expect(await auditActions(paymentId)).toContain("payment.queued_unmatched");
  });

  it("queues a matched tenant that is outside the actor's scope", async () => {
    await seedPortfolio();

    const result = await commitBankStatement(
      finance,
      input(statement(["03/04/2026,EQ010,Rent,45000.00,,+254723456789"])),
    );

    expect(result.queued).toBe(1);
    const paymentId = paymentIdForReference("bank", "EQ010");
    expect((await paymentData(paymentId))?.status).toBe("unmatched");
    expect((await unmatchedData(`unm_${paymentId}`))?.reason).toContain(
      "outside the properties",
    );
  });

  it("counts a re-imported reference as a duplicate and writes nothing", async () => {
    await seedPortfolio();
    const file = input(statement(["03/04/2026,EQ003,Rent,45000.00,,+254712345678"]));

    const first = await commitBankStatement(admin, file);
    const second = await commitBankStatement(admin, file);

    expect(first.imported).toBe(1);
    expect(second).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await count("payments")).toBe(1);

    const runs = await listRecentBankImports(admin, 10);
    expect(runs).toHaveLength(2);
    expect(runs[0].duplicates).toBe(1);
  });

  it("imports the good rows while reporting errors and skipped rows", async () => {
    await seedPortfolio();

    const result = await commitBankStatement(
      admin,
      input(
        statement([
          "not-a-date,EQ004,Rent,1000.00,,",
          "03/04/2026,,Rent,1000.00,,",
          "03/04/2026,EQ005,Rent,45000.00,,+254712345678",
          "03/04/2026,EQ006,Fee,,1200.00,",
          "Totals,,,45000.00,1200.00,",
        ]),
      ),
    );

    expect(result).toMatchObject({
      imported: 1,
      queued: 0,
      skipped: 2,
      errors: 2,
    });
  });

  it("requires receipt-entry and reconciliation capabilities", async () => {
    await seedPortfolio();
    const file = input(statement(["03/04/2026,EQ007,Rent,45000.00,,+254712345678"]));

    await expect(commitBankStatement(manager, file)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await count("bankSyncRuns")).toBe(0);
  });
});

describe("listRecentBankImports", () => {
  it("returns statement runs newest first and hides API runs", async () => {
    await seedPortfolio();
    await commitBankStatement(
      admin,
      input(statement(["03/04/2026,EQ008,Rent,1000.00,,+254712345678"])),
    );
    await db()
      .collection("bankSyncRuns")
      .doc("run_api")
      .set({
        bankCode: "EQ",
        source: "api",
        status: "succeeded",
        startedAt: FieldValue.serverTimestamp(),
        counts: { fetched: 1, imported: 1, duplicates: 0, errors: 0 },
      });

    const runs = await listRecentBankImports(admin, 10);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      bankCode: "EQ",
      imported: 1,
      fileName: "equity-april.csv",
    });
  });
});
