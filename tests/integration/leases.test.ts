import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { parseDateInput, todayIsoDate } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import type { LeaseCreateInput } from "@/lib/validation/lease";
import {
  activateLease,
  createLease,
  getLease,
  getOpenLeaseForUnit,
  listLeases,
  renewLease,
  terminateLease,
  updateLeaseTerms,
} from "@/services/leases";

const db = () => adminDb();
const DAY_MS = 86_400_000;

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

/** Nairobi midnight `offset` days from today. */
function daysFromToday(offset: number): Date {
  const base = parseDateInput(todayIsoDate());
  if (!base) throw new Error("Could not resolve today's date.");
  return new Date(base.getTime() + offset * DAY_MS);
}

function leaseInput(overrides: Partial<LeaseCreateInput> = {}): LeaseCreateInput {
  return {
    tenantId: "tnt_1",
    unitId: "unit_1",
    startDate: daysFromToday(0),
    endDate: daysFromToday(365),
    rentAmount: 1_000_000,
    depositAmount: 2_000_000,
    dueDay: 5,
    ...overrides,
  };
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

async function seedProperty(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("properties")
    .doc(id)
    .set({
      name: id,
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
      status: "vacant",
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
      fullNameLower: "grace wanjiru",
      phoneE164: "+254712345678",
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
      startDate: Timestamp.fromDate(daysFromToday(-30)),
      endDate: Timestamp.fromDate(daysFromToday(335)),
      rentAmountMinor: 4_500_000,
      currency: "KES",
      dueDay: 5,
      depositAmountMinor: 9_000_000,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

function leaseData(id: string) {
  return db().collection("leases").doc(id).get().then((doc) => doc.data());
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
  await seedProperty("prop_1");
  await seedProperty("prop_2");
  await seedUnit("unit_1");
  await seedTenant("tnt_1");
}

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    [
      "properties",
      "units",
      "leases",
      "tenants",
      "tenantPhones",
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

describe("createLease", () => {
  it("creates a pending lease, widens tenant property scope and audits it", async () => {
    await seedPortfolio();
    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ propertyIds: ["prop_2"] });

    const id = await createLease(admin, leaseInput({ unitId: "unit_1" }));

    const lease = await leaseData(id);
    expect(lease?.status).toBe("pending");
    expect(lease?.tenantId).toBe("tnt_1");
    expect(lease?.unitId).toBe("unit_1");
    expect(lease?.propertyId).toBe("prop_1");
    expect(lease?.rentAmountMinor).toBe(1_000_000);
    expect(lease?.depositAmountMinor).toBe(2_000_000);
    expect(lease?.currency).toBe("KES");
    expect(lease?.dueDay).toBe(5);

    const tenant = (await db().collection("tenants").doc("tnt_1").get()).data();
    expect(tenant?.propertyIds).toEqual(
      expect.arrayContaining(["prop_1", "prop_2"]),
    );

    // A pending lease never occupies the unit.
    const unit = (await db().collection("units").doc("unit_1").get()).data();
    expect(unit?.status).toBe("vacant");
    expect(unit?.activeLeaseId).toBeUndefined();

    expect(await auditActions(id)).toContain("lease.created");
  });

  it("refuses a second open lease on the same unit", async () => {
    await seedPortfolio();
    await createLease(admin, leaseInput());

    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses an occupied, archived or maintenance unit", async () => {
    await seedPortfolio();
    await db()
      .collection("units")
      .doc("unit_1")
      .update({ status: "occupied", activeLeaseId: "lease_other" });
    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });

    await db()
      .collection("units")
      .doc("unit_1")
      .update({ status: "vacant", activeLeaseId: FieldValue.delete(), active: false });
    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });

    await db()
      .collection("units")
      .doc("unit_1")
      .update({ active: true, status: "maintenance" });
    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses an inactive tenant and a tenant with a live lease", async () => {
    await seedPortfolio();
    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ status: "inactive" });
    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });

    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ status: "active", currentLeaseId: "lease_live" });
    await expect(createLease(admin, leaseInput())).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses an archived property", async () => {
    await seedPortfolio();
    await seedProperty("prop_closed", { active: false });
    await seedUnit("unit_closed", { propertyId: "prop_closed" });
    await seedTenant("tnt_closed", { propertyIds: ["prop_closed"] });

    await expect(
      createLease(admin, leaseInput({ unitId: "unit_closed", tenantId: "tnt_closed" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces property scope and tenant access", async () => {
    await seedPortfolio();

    await expect(createLease(otherManager, leaseInput())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(createLease(manager, leaseInput())).resolves.toBeTruthy();

    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ propertyIds: ["prop_2"], createdBy: "uid_someone_else" });
    await expect(createLease(manager, leaseInput())).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("returns not_found for a missing unit or tenant", async () => {
    await seedPortfolio();

    await expect(
      createLease(admin, leaseInput({ unitId: "unit_missing" })),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      createLease(admin, leaseInput({ tenantId: "tnt_missing" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("activateLease", () => {
  it("occupies the unit, links the tenant and audits the activation", async () => {
    await seedPortfolio();
    const id = await createLease(admin, leaseInput());

    await activateLease(admin, id);

    expect((await leaseData(id))?.status).toBe("active");
    const unit = (await db().collection("units").doc("unit_1").get()).data();
    expect(unit?.status).toBe("occupied");
    expect(unit?.activeLeaseId).toBe(id);
    expect(unit?.activeTenantId).toBe("tnt_1");

    const tenant = (await db().collection("tenants").doc("tnt_1").get()).data();
    expect(tenant?.currentLeaseId).toBe(id);
    expect(tenant?.currentUnitId).toBe("unit_1");
    expect(tenant?.currentPropertyId).toBe("prop_1");

    expect(await auditActions(id)).toContain("lease.activated");
  });

  it("refuses a future start date and an ended term", async () => {
    await seedPortfolio();
    const future = await createLease(
      admin,
      leaseInput({ startDate: daysFromToday(2), endDate: daysFromToday(367) }),
    );
    await expect(activateLease(admin, future)).rejects.toMatchObject({
      code: "conflict",
    });

    await seedUnit("unit_ended");
    const ended = await createLease(
      admin,
      leaseInput({
        unitId: "unit_ended",
        startDate: daysFromToday(-60),
        endDate: daysFromToday(-1),
      }),
    );
    await expect(activateLease(admin, ended)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses a double activation", async () => {
    await seedPortfolio();
    const id = await createLease(admin, leaseInput());
    await activateLease(admin, id);

    await expect(activateLease(admin, id)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses a unit already held by another lease", async () => {
    await seedPortfolio();
    await db()
      .collection("units")
      .doc("unit_1")
      .update({ status: "occupied", activeLeaseId: "lease_other" });
    await seedLease("lease_pending", { status: "pending" });

    await expect(activateLease(admin, "lease_pending")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses a tenant already held by another lease", async () => {
    await seedPortfolio();
    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({ currentLeaseId: "lease_other" });
    await seedLease("lease_pending", { status: "pending" });

    await expect(activateLease(admin, "lease_pending")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("expires the source lease when a renewal is activated", async () => {
    await seedPortfolio();
    await db()
      .collection("units")
      .doc("unit_1")
      .update({ status: "occupied", activeLeaseId: "lease_old", activeTenantId: "tnt_1" });
    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({
        currentLeaseId: "lease_old",
        currentUnitId: "unit_1",
        currentPropertyId: "prop_1",
      });
    await seedLease("lease_old");

    const renewal = await renewLease(admin, "lease_old", {
      startDate: daysFromToday(0),
      endDate: daysFromToday(365),
      rentAmount: 5_000_000,
      dueDay: 5,
      reason: "Tenant renewed for another year.",
    });

    await activateLease(admin, renewal);

    expect((await leaseData("lease_old"))?.status).toBe("expired");
    expect((await leaseData(renewal))?.status).toBe("active");
    const unit = (await db().collection("units").doc("unit_1").get()).data();
    expect(unit?.activeLeaseId).toBe(renewal);
    const tenant = (await db().collection("tenants").doc("tnt_1").get()).data();
    expect(tenant?.currentLeaseId).toBe(renewal);

    expect(await auditActions("lease_old")).toContain("lease.expired");
    expect(await auditActions(renewal)).toContain("lease.activated");
  });

  it("returns not_found and forbidden for detail access", async () => {
    await seedPortfolio();
    const id = await createLease(admin, leaseInput());

    await expect(activateLease(admin, "lease_missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(activateLease(otherManager, id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("terminateLease", () => {
  it("vacates the unit, clears the tenant and audits an active termination", async () => {
    await seedPortfolio();
    await db()
      .collection("units")
      .doc("unit_1")
      .update({ status: "occupied", activeLeaseId: "lease_1", activeTenantId: "tnt_1" });
    await db()
      .collection("tenants")
      .doc("tnt_1")
      .update({
        currentLeaseId: "lease_1",
        currentUnitId: "unit_1",
        currentPropertyId: "prop_1",
      });
    await seedLease("lease_1");

    await terminateLease(admin, "lease_1", {
      reason: "Tenant moved to another town.",
    });

    const lease = await leaseData("lease_1");
    expect(lease?.status).toBe("terminated");
    expect(lease?.terminationReason).toBe("Tenant moved to another town.");
    expect(lease?.terminatedAt).toBeTruthy();

    const unit = (await db().collection("units").doc("unit_1").get()).data();
    expect(unit?.status).toBe("vacant");
    expect(unit?.activeLeaseId).toBeUndefined();
    expect(unit?.activeTenantId).toBeUndefined();

    const tenant = (await db().collection("tenants").doc("tnt_1").get()).data();
    expect(tenant?.currentLeaseId).toBeUndefined();
    expect(tenant?.currentUnitId).toBeUndefined();
    expect(tenant?.currentPropertyId).toBeUndefined();

    expect(await auditActions("lease_1")).toContain("lease.terminated");
  });

  it("cancels a pending lease without touching the unit or tenant", async () => {
    await seedPortfolio();
    const id = await createLease(admin, leaseInput());

    await terminateLease(admin, id, { reason: "Applicant withdrew." });

    expect((await leaseData(id))?.status).toBe("terminated");
    const unit = (await db().collection("units").doc("unit_1").get()).data();
    expect(unit?.status).toBe("vacant");
    expect(unit?.activeLeaseId).toBeUndefined();
    const tenant = (await db().collection("tenants").doc("tnt_1").get()).data();
    expect(tenant?.currentLeaseId).toBeUndefined();
  });

  it("refuses a double termination", async () => {
    await seedPortfolio();
    const id = await createLease(admin, leaseInput());
    await terminateLease(admin, id, { reason: "Applicant withdrew." });

    await expect(
      terminateLease(admin, id, { reason: "Applicant withdrew." }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("validates an early end date against the agreed term", async () => {
    await seedPortfolio();
    await seedLease("lease_1");

    await expect(
      terminateLease(admin, "lease_1", {
        reason: "Early exit negotiated.",
        endDate: daysFromToday(-40),
      }),
    ).rejects.toMatchObject({ code: "validation" });

    await expect(
      terminateLease(admin, "lease_1", {
        reason: "Early exit negotiated.",
        endDate: daysFromToday(400),
      }),
    ).rejects.toMatchObject({ code: "validation" });

    await terminateLease(admin, "lease_1", {
      reason: "Early exit negotiated.",
      endDate: daysFromToday(0),
    });
    const endDate = (await leaseData("lease_1"))?.endDate as Timestamp;
    expect(endDate.toDate().getTime()).toBe(daysFromToday(0).getTime());
  });

  it("enforces scope and not_found", async () => {
    await seedPortfolio();
    await seedLease("lease_1");

    await expect(
      terminateLease(otherManager, "lease_1", { reason: "Out of scope." }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      terminateLease(admin, "lease_missing", { reason: "No such lease." }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("renewLease", () => {
  it("requires an active source lease", async () => {
    await seedPortfolio();
    await seedLease("lease_pending", { status: "pending" });

    await expect(
      renewLease(admin, "lease_pending", {
        startDate: daysFromToday(0),
        endDate: daysFromToday(365),
        rentAmount: 4_500_000,
        dueDay: 5,
        reason: "Rolling the term over.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("inherits the deposit, links the source and audits the reason", async () => {
    await seedPortfolio();
    await seedLease("lease_old", { depositAmountMinor: 7_000_000 });

    const id = await renewLease(admin, "lease_old", {
      startDate: daysFromToday(0),
      endDate: daysFromToday(365),
      rentAmount: 5_000_000,
      dueDay: 10,
      reason: "Annual renewal at the new rent.",
    });

    const lease = await leaseData(id);
    expect(lease?.status).toBe("pending");
    expect(lease?.renewedFromLeaseId).toBe("lease_old");
    expect(lease?.tenantId).toBe("tnt_1");
    expect(lease?.unitId).toBe("unit_1");
    expect(lease?.propertyId).toBe("prop_1");
    expect(lease?.depositAmountMinor).toBe(7_000_000);
    expect(lease?.rentAmountMinor).toBe(5_000_000);
    expect(lease?.dueDay).toBe(10);

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "lease.renewed")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().reason).toBe("Annual renewal at the new rent.");
    expect(log.docs[0].data().after?.renewedFromLeaseId).toBe("lease_old");
  });

  it("refuses a start date before the current term", async () => {
    await seedPortfolio();
    await seedLease("lease_old", { startDate: Timestamp.fromDate(daysFromToday(-30)) });

    await expect(
      renewLease(admin, "lease_old", {
        startDate: daysFromToday(-60),
        endDate: daysFromToday(365),
        rentAmount: 4_500_000,
        dueDay: 5,
        reason: "Too far back to renew.",
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("enforces scope and not_found", async () => {
    await seedPortfolio();
    await seedLease("lease_old");

    await expect(
      renewLease(otherManager, "lease_old", {
        startDate: daysFromToday(0),
        endDate: daysFromToday(365),
        rentAmount: 4_500_000,
        dueDay: 5,
        reason: "Out of scope renewal.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      renewLease(admin, "lease_missing", {
        startDate: daysFromToday(0),
        endDate: daysFromToday(365),
        rentAmount: 4_500_000,
        dueDay: 5,
        reason: "No such lease to renew.",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("updateLeaseTerms", () => {
  it("updates rent, deposit and due day with before/after audit", async () => {
    await seedPortfolio();
    await seedLease("lease_1");

    await updateLeaseTerms(manager, "lease_1", {
      rentAmount: 5_500_000,
      depositAmount: 11_000_000,
      dueDay: 10,
      reason: "Landlord revised the rent at renewal.",
    });

    const lease = await leaseData("lease_1");
    expect(lease?.rentAmountMinor).toBe(5_500_000);
    expect(lease?.depositAmountMinor).toBe(11_000_000);
    expect(lease?.dueDay).toBe(10);

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", "lease_1")
      .where("action", "==", "lease.terms_updated")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().before?.rentAmountMinor).toBe(4_500_000);
    expect(log.docs[0].data().after?.rentAmountMinor).toBe(5_500_000);
    expect(log.docs[0].data().reason).toBe("Landlord revised the rent at renewal.");
  });

  it("refuses a terminated or expired lease", async () => {
    await seedPortfolio();
    await seedLease("lease_terminated", { status: "terminated" });
    await seedLease("lease_expired", { status: "expired" });

    const terms = {
      rentAmount: 5_000_000,
      depositAmount: 10_000_000,
      dueDay: 7,
      reason: "Attempting a late change.",
    };

    await expect(
      updateLeaseTerms(admin, "lease_terminated", terms),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      updateLeaseTerms(admin, "lease_expired", terms),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces scope and not_found", async () => {
    await seedPortfolio();
    await seedLease("lease_1");

    const terms = {
      rentAmount: 5_000_000,
      depositAmount: 10_000_000,
      dueDay: 7,
      reason: "Attempting an out-of-scope change.",
    };

    await expect(
      updateLeaseTerms(otherManager, "lease_1", terms),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateLeaseTerms(admin, "lease_missing", terms),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("lease queries", () => {
  it("scopes lists to the actor's properties and filters by property/status", async () => {
    await seedPortfolio();
    await seedUnit("unit_2", { propertyId: "prop_2", unitNumber: "B1" });
    await seedTenant("tnt_2", { propertyIds: ["prop_2"], createdBy: "uid_admin" });

    await seedLease("lease_p1", {
      startDate: Timestamp.fromDate(daysFromToday(-10)),
      status: "active",
    });
    await seedLease("lease_p2", {
      tenantId: "tnt_2",
      unitId: "unit_2",
      propertyId: "prop_2",
      startDate: Timestamp.fromDate(daysFromToday(-5)),
      status: "active",
    });
    await seedLease("lease_p1_ended", {
      status: "terminated",
      startDate: Timestamp.fromDate(daysFromToday(-20)),
    });

    const managerPage = await listLeases(manager, {});
    expect(managerPage.items.map((lease) => lease.id)).toEqual([
      "lease_p1",
      "lease_p1_ended",
    ]);

    const adminPage = await listLeases(admin, { status: "active" });
    expect(adminPage.items.map((lease) => lease.id)).toEqual([
      "lease_p2",
      "lease_p1",
    ]);

    const filtered = await listLeases(manager, {
      propertyId: "prop_1",
      status: "terminated",
    });
    expect(filtered.items.map((lease) => lease.id)).toEqual(["lease_p1_ended"]);

    await expect(
      listLeases(manager, { propertyId: "prop_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      listLeases(actor("property_manager", [], "uid_empty"), {}),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("searches tenant name, phone, unit number and property name", async () => {
    await seedPortfolio();
    await seedLease("lease_1");
    await db().collection("units").doc("unit_1").update({ unitNumber: "A1" });

    expect((await listLeases(admin, { q: "wanjiru" })).items).toHaveLength(1);
    expect((await listLeases(admin, { q: "712345" })).items).toHaveLength(1);
    expect((await listLeases(admin, { q: "a1" })).items).toHaveLength(1);
    expect((await listLeases(admin, { q: "prop_1" })).items).toHaveLength(1);
    expect((await listLeases(admin, { q: "nobody" })).items).toHaveLength(0);
  });

  it("paginates with a cursor", async () => {
    await seedPortfolio();
    await seedLease("lease_a", { startDate: Timestamp.fromDate(daysFromToday(-30)) });
    await seedLease("lease_b", { startDate: Timestamp.fromDate(daysFromToday(-20)) });
    await seedLease("lease_c", { startDate: Timestamp.fromDate(daysFromToday(-10)) });

    const first = await listLeases(admin, { pageSize: 2 });
    expect(first.items.map((lease) => lease.id)).toEqual(["lease_c", "lease_b"]);
    expect(first.nextCursor).toBe("lease_b");

    const second = await listLeases(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((lease) => lease.id)).toEqual(["lease_a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("decorates lease details and returns not_found or forbidden", async () => {
    await seedPortfolio();
    await seedLease("lease_old", { startDate: Timestamp.fromDate(daysFromToday(-400)) });
    await seedLease("lease_new", {
      status: "active",
      startDate: Timestamp.fromDate(daysFromToday(-10)),
      renewedFromLeaseId: "lease_old",
    });

    const lease = await getLease(admin, "lease_old");
    expect(lease.tenantName).toBe("Grace Wanjiru");
    expect(lease.tenantPhone).toBe("+254712345678");
    expect(lease.unitNumber).toBe("UNIT_1");
    expect(lease.propertyName).toBe("prop_1");
    expect(lease.currency).toBe("KES");
    expect(lease.renewedToLeaseId).toBe("lease_new");

    await expect(getLease(admin, "lease_missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getLease(otherManager, "lease_old")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("finds the open lease for a unit and enforces scope", async () => {
    await seedPortfolio();
    expect(await getOpenLeaseForUnit(admin, "unit_1")).toBeNull();

    await seedLease("lease_active", { status: "active" });
    const open = await getOpenLeaseForUnit(admin, "unit_1");
    expect(open?.id).toBe("lease_active");

    await expect(getOpenLeaseForUnit(otherManager, "unit_1")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
