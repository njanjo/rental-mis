import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import type { UnitInput } from "@/lib/validation/unit";
import {
  archiveUnit,
  createUnit,
  getUnit,
  getUnitLeaseHistory,
  getUnitOptions,
  listUnits,
  restoreUnit,
  updateUnit,
} from "@/services/units";

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

function input(overrides: Partial<UnitInput> = {}): UnitInput {
  return {
    propertyId: "prop_1",
    unitNumber: "A1",
    rentAmount: 4_500_000,
    depositAmount: 9_000_000,
    status: "vacant",
    notes: undefined,
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

async function seedTenant(id: string, fullName: string): Promise<void> {
  const digits = id.replace(/\D/g, "").padStart(8, "0").slice(-8);
  await db()
    .collection("tenants")
    .doc(id)
    .set({
      fullName,
      fullNameLower: fullName.toLowerCase(),
      phoneE164: `+2547${digits}`,
      status: "active",
      consentSms: true,
      propertyIds: ["prop_1"],
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
      startDate: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
      endDate: Timestamp.fromDate(new Date("2027-01-01T00:00:00Z")),
      rentAmountMinor: 1_000_000,
      currency: "KES",
      dueDay: 5,
      depositAmountMinor: 2_000_000,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
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

  await seedUser(admin);
  await seedUser(manager);
  await seedUser(otherManager);
  await seedProperty("prop_1");
  await seedProperty("prop_2");
});

describe("createUnit", () => {
  it("creates a unit, keeps money in minor units and audits the change", async () => {
    const id = await createUnit(
      admin,
      input({ unitNumber: "a1", notes: "Meter 2211" }),
    );

    const data = (await db().collection("units").doc(id).get()).data();
    expect(data?.unitNumber).toBe("A1");
    expect(data?.rentAmountMinor).toBe(4_500_000);
    expect(data?.depositAmountMinor).toBe(9_000_000);
    expect(data?.currency).toBe("KES");
    expect(data?.status).toBe("vacant");
    expect(data?.active).toBe(true);
    expect(data?.notes).toBe("Meter 2211");
    expect(await auditActions(id)).toContain("unit.created");
  });

  it("rejects a duplicate unit number in the same property", async () => {
    await createUnit(admin, input());
    await expect(createUnit(admin, input({ unitNumber: "a1" }))).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("allows the same unit number in another property", async () => {
    await createUnit(admin, input());
    await expect(
      createUnit(admin, input({ propertyId: "prop_2" })),
    ).resolves.toBeTruthy();
  });

  it("refuses to create an occupied unit", async () => {
    await expect(
      createUnit(admin, input({ status: "occupied" })),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("refuses an archived property and an out-of-scope manager", async () => {
    await seedProperty("prop_closed", { active: false });
    await expect(
      createUnit(admin, input({ propertyId: "prop_closed" })),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(createUnit(otherManager, input())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(createUnit(manager, input())).resolves.toBeTruthy();
  });
});

describe("updateUnit", () => {
  it("updates rent, deposit, status and notes with before/after audit", async () => {
    const id = await createUnit(admin, input({ notes: "Old note" }));

    await updateUnit(manager, id, {
      rentAmount: 5_000_000,
      depositAmount: 10_000_000,
      status: "maintenance",
      notes: "Repainting",
    });

    const data = (await db().collection("units").doc(id).get()).data();
    expect(data?.rentAmountMinor).toBe(5_000_000);
    expect(data?.depositAmountMinor).toBe(10_000_000);
    expect(data?.status).toBe("maintenance");
    expect(data?.notes).toBe("Repainting");

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "unit.updated")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().before?.rentAmountMinor).toBe(4_500_000);
    expect(log.docs[0].data().after?.rentAmountMinor).toBe(5_000_000);
  });

  it("refuses occupancy changes while a lease is active", async () => {
    const id = await createUnit(admin, input());
    await seedLease("lease_1", { unitId: id, status: "active" });
    await db().collection("units").doc(id).update({ activeLeaseId: "lease_1", status: "occupied" });

    await expect(
      updateUnit(admin, id, {
        rentAmount: 4_500_000,
        depositAmount: 9_000_000,
        status: "vacant",
        notes: undefined,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(
      updateUnit(admin, id, {
        rentAmount: 4_500_000,
        depositAmount: 9_000_000,
        status: "occupied",
        notes: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to mark a unit occupied without a lease", async () => {
    const id = await createUnit(admin, input());
    await expect(
      updateUnit(admin, id, {
        rentAmount: 4_500_000,
        depositAmount: 9_000_000,
        status: "occupied",
        notes: undefined,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("blocks a manager outside the property and edits on an archived unit", async () => {
    const id = await createUnit(admin, input());

    await expect(
      updateUnit(otherManager, id, {
        rentAmount: 1,
        depositAmount: 1,
        status: "vacant",
        notes: undefined,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await archiveUnit(admin, id, "Retired from the portfolio");
    await expect(
      updateUnit(admin, id, {
        rentAmount: 1,
        depositAmount: 1,
        status: "vacant",
        notes: undefined,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("archiveUnit and restoreUnit", () => {
  it("archives a unit with no open leases and restores it", async () => {
    const id = await createUnit(admin, input());

    await archiveUnit(admin, id, "Sold by the owner");
    let data = (await db().collection("units").doc(id).get()).data();
    expect(data?.active).toBe(false);
    expect(data?.status).toBe("vacant");
    expect(data?.archiveReason).toBe("Sold by the owner");
    expect(await auditActions(id)).toContain("unit.archived");

    const listed = await listUnits(admin, {});
    expect(listed.items.map((item) => item.id)).not.toContain(id);

    await restoreUnit(admin, id, "Brought back into service");
    data = (await db().collection("units").doc(id).get()).data();
    expect(data?.active).toBe(true);
    expect(data?.status).toBe("vacant");
    expect(data?.archiveReason).toBeUndefined();
    expect(await auditActions(id)).toContain("unit.restored");
  });

  it("refuses to archive a unit with an open lease", async () => {
    const id = await createUnit(admin, input());
    await seedLease("lease_1", { unitId: id, status: "pending" });

    await expect(archiveUnit(admin, id, "Closing the unit")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("ignores terminated leases when archiving", async () => {
    const id = await createUnit(admin, input());
    await seedLease("lease_1", { unitId: id, status: "terminated" });

    await expect(
      archiveUnit(admin, id, "Tenant moved out"),
    ).resolves.toBeUndefined();
  });

  it("rejects double archive, double restore and a duplicate on restore", async () => {
    const id = await createUnit(admin, input());
    await archiveUnit(admin, id, "Closing the unit");
    await expect(archiveUnit(admin, id, "Closing the unit")).rejects.toMatchObject({
      code: "conflict",
    });

    await createUnit(admin, input({ unitNumber: "A1" }));
    await expect(
      restoreUnit(admin, id, "Reopening the unit"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("unit queries", () => {
  it("scopes lists to the actor's properties", async () => {
    const mine = await createUnit(admin, input());
    await createUnit(admin, input({ propertyId: "prop_2", unitNumber: "B1" }));

    const scoped = await listUnits(manager, {});
    expect(scoped.items.map((item) => item.id)).toEqual([mine]);

    const all = await listUnits(admin, {});
    expect(all.items).toHaveLength(2);
  });

  it("filters by property and status, and searches by unit or tenant", async () => {
    const a1 = await createUnit(admin, input({ unitNumber: "A1" }));
    await createUnit(admin, input({ unitNumber: "A2", status: "maintenance" }));
    await createUnit(admin, input({ propertyId: "prop_2", unitNumber: "B1" }));

    expect((await listUnits(admin, { propertyId: "prop_1" })).items).toHaveLength(2);
    expect((await listUnits(admin, { status: "maintenance" })).items).toHaveLength(1);
    expect((await listUnits(admin, { q: "a1" })).items.map((item) => item.id)).toEqual([
      a1,
    ]);

    await seedTenant("tnt_1", "Grace Wanjiru");
    await db().collection("units").doc(a1).update({
      activeLeaseId: "lease_1",
      activeTenantId: "tnt_1",
      status: "occupied",
    });
    expect((await listUnits(admin, { q: "wanjiru" })).items.map((item) => item.id)).toEqual([
      a1,
    ]);
  });

  it("paginates with a cursor", async () => {
    await createUnit(admin, input({ unitNumber: "A1" }));
    await createUnit(admin, input({ unitNumber: "A2" }));
    await createUnit(admin, input({ unitNumber: "A3" }));

    const first = await listUnits(admin, { pageSize: 2 });
    expect(first.items.map((item) => item.unitNumber)).toEqual(["A1", "A2"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await listUnits(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.unitNumber)).toEqual(["A3"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns not_found and forbidden for detail reads", async () => {
    const id = await createUnit(admin, input());

    await expect(getUnit(manager, id)).resolves.toMatchObject({ id });
    await expect(getUnit(otherManager, id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getUnit(admin, "missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lists lease history newest first", async () => {
    const id = await createUnit(admin, input());
    await seedTenant("tnt_1", "Grace Wanjiru");
    await seedLease("lease_old", {
      unitId: id,
      startDate: Timestamp.fromDate(new Date("2024-01-01T00:00:00Z")),
      status: "expired",
    });
    await seedLease("lease_new", {
      unitId: id,
      startDate: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
      status: "active",
    });

    const history = await getUnitLeaseHistory(admin, id);
    expect(history.map((lease) => lease.id)).toEqual(["lease_new", "lease_old"]);
    expect(history[0].tenantName).toBe("Grace Wanjiru");
  });

  it("only offers vacant units unless asked for occupied ones", async () => {
    const vacant = await createUnit(admin, input({ unitNumber: "A1" }));
    const occupied = await createUnit(admin, input({ unitNumber: "A2" }));
    await seedLease("lease_1", { unitId: occupied, status: "active" });
    await db()
      .collection("units")
      .doc(occupied)
      .update({ activeLeaseId: "lease_1", status: "occupied" });

    expect((await getUnitOptions(admin)).map((option) => option.id)).toEqual([vacant]);
    expect(
      (await getUnitOptions(admin, { includeOccupied: true })).map((option) => option.id),
    ).toContain(occupied);
  });

  it("refuses an empty scope instead of returning everything", async () => {
    await createUnit(admin, input());
    await expect(
      listUnits(actor("property_manager", [], "uid_empty"), {}),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
