import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import {
  archiveProperty,
  createProperty,
  getProperty,
  getPropertyOptions,
  listProperties,
  restoreProperty,
  updateProperty,
} from "@/services/properties";
import type { PropertyInput } from "@/lib/validation/property";

const db = () => adminDb();

function actor(role: Role, propertyIds: string[] = [], uid = `uid_${role}`): SessionUser {
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
const manager = actor("property_manager", [], "uid_manager");
const otherManager = actor("property_manager", [], "uid_other_manager");

function input(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return {
    name: "Kilimani Heights",
    address: "Wood Avenue, Kilimani",
    county: "Nairobi",
    managerIds: [],
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

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

async function activeLease(propertyId: string): Promise<void> {
  await db()
    .collection("leases")
    .doc(`lease_${propertyId}`)
    .set({
      tenantId: "tnt_1",
      unitId: "unit_1",
      propertyId,
      startDate: Timestamp.fromDate(new Date("2026-01-01T00:00:00Z")),
      endDate: Timestamp.fromDate(new Date("2027-01-01T00:00:00Z")),
      rentAmountMinor: 1_000_000,
      currency: "KES",
      dueDay: 5,
      depositAmountMinor: 2_000_000,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
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
});

describe("createProperty", () => {
  it("creates a property, lower-cases the name and audits the change", async () => {
    const id = await createProperty(
      admin,
      input({ managerIds: [manager.uid], notes: "Caretaker on site" }),
    );

    const snapshot = await db().collection("properties").doc(id).get();
    const data = snapshot.data();
    expect(data?.name).toBe("Kilimani Heights");
    expect(data?.nameLower).toBe("kilimani heights");
    expect(data?.active).toBe(true);
    expect(data?.managerIds).toEqual([manager.uid]);
    expect(data?.notes).toBe("Caretaker on site");
    expect(await auditActions(id)).toContain("property.created");
  });

  it("auto-assigns a property manager to a property they create", async () => {
    const id = await createProperty(
      manager,
      input({ name: "Riverbend Court", managerIds: [otherManager.uid] }),
    );

    const data = (await db().collection("properties").doc(id).get()).data();
    expect(data?.managerIds).toEqual([manager.uid]);

    // Scope is read from the staff profile, so the profile must be updated too.
    const profile = (await db().collection("users").doc(manager.uid).get()).data();
    expect(profile?.propertyIds).toEqual([id]);
  });

  it("rejects unknown managers", async () => {
    await expect(
      createProperty(admin, input({ managerIds: ["nobody"] })),
    ).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("refuses roles without the manage_properties capability", async () => {
    await expect(createProperty(actor("finance"), input())).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(createProperty(actor("auditor"), input())).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("updateProperty", () => {
  it("updates fields and records before/after values", async () => {
    const id = await createProperty(admin, input({ managerIds: [manager.uid] }));

    await updateProperty(admin, id, {
      ...input({ managerIds: [otherManager.uid] }),
      name: "Kilimani Heights Phase 2",
      county: "Kiambu",
    });

    const data = (await db().collection("properties").doc(id).get()).data();
    expect(data?.nameLower).toBe("kilimani heights phase 2");
    expect(data?.county).toBe("Kiambu");
    expect(data?.managerIds).toEqual([otherManager.uid]);

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "property.updated")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().before?.name).toBe("Kilimani Heights");
    expect(log.docs[0].data().after?.name).toBe("Kilimani Heights Phase 2");
  });

  it("blocks a manager who is not scoped to the property", async () => {
    const id = await createProperty(admin, input({ managerIds: [manager.uid] }));

    await expect(
      updateProperty(otherManager, id, input({ name: "Hijacked" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateProperty(actor("property_manager", [id], manager.uid), id, input({ name: "Renamed by manager" })),
    ).resolves.toBeUndefined();
  });

  it("returns not_found for a missing property", async () => {
    await expect(
      updateProperty(admin, "does_not_exist", input()),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("adds and removes manager scope when assignments change", async () => {
    const id = await createProperty(admin, input({ managerIds: [manager.uid] }));
    const read = () => db().collection("users").doc(manager.uid).get();

    expect((await read()).data()?.propertyIds).toEqual([id]);

    await updateProperty(admin, id, input({ managerIds: [otherManager.uid] }));

    expect((await read()).data()?.propertyIds).toEqual([]);
    const otherProfile = (await db().collection("users").doc(otherManager.uid).get()).data();
    expect(otherProfile?.propertyIds).toEqual([id]);
  });
});

describe("archiveProperty and restoreProperty", () => {
  it("archives when no lease is pending or active", async () => {
    const id = await createProperty(admin, input());

    await archiveProperty(admin, id, "Sold by the owner");

    const data = (await db().collection("properties").doc(id).get()).data();
    expect(data?.active).toBe(false);
    expect(data?.archivedAt).toBeTruthy();
    expect(await auditActions(id)).toContain("property.archived");

    const listed = await listProperties(admin, {});
    expect(listed.items.map((item) => item.id)).not.toContain(id);
  });

  it("refuses to archive a property with an active lease", async () => {
    const id = await createProperty(admin, input());
    await activeLease(id);

    await expect(archiveProperty(admin, id, "Closing down")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("ignores terminated leases when archiving", async () => {
    const id = await createProperty(admin, input());
    await activeLease(id);
    await db().collection("leases").doc(`lease_${id}`).update({ status: "terminated" });

    await expect(archiveProperty(admin, id, "Tenant moved out")).resolves.toBeUndefined();
  });

  it("restores an archived property and clears the archive timestamp", async () => {
    const id = await createProperty(admin, input());
    await archiveProperty(admin, id, "Temporary closure");

    await restoreProperty(admin, id, "Reopened");

    const data = (await db().collection("properties").doc(id).get()).data();
    expect(data?.active).toBe(true);
    expect(data?.archivedAt).toBeUndefined();
    expect(await auditActions(id)).toContain("property.restored");
  });

  it("rejects double archive and double restore", async () => {
    const id = await createProperty(admin, input());
    await archiveProperty(admin, id, "Closing down");
    await expect(archiveProperty(admin, id, "Closing down")).rejects.toMatchObject({
      code: "conflict",
    });

    await restoreProperty(admin, id, "Reopening");
    await expect(restoreProperty(admin, id, "Reopening")).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

describe("property queries", () => {
  it("scopes lists to the actor's properties", async () => {
    const kilimani = await createProperty(admin, input({ managerIds: [manager.uid] }));
    await createProperty(admin, input({ name: "Nyali Beach Court", county: "Mombasa" }));

    const scoped = await listProperties(
      actor("property_manager", [kilimani], manager.uid),
      {},
    );
    expect(scoped.items.map((item) => item.id)).toEqual([kilimani]);

    const all = await listProperties(admin, {});
    expect(all.items).toHaveLength(2);
  });

  it("filters by county and reports unit counts", async () => {
    const id = await createProperty(admin, input());
    await createProperty(admin, input({ name: "Nyali Beach Court", county: "Mombasa" }));

    await db().collection("units").doc("unit_1").set({
      propertyId: id,
      unitNumber: "A1",
      active: true,
      status: "occupied",
    });
    await db().collection("units").doc("unit_2").set({
      propertyId: id,
      unitNumber: "A2",
      active: true,
      status: "vacant",
    });
    await db().collection("units").doc("unit_3").set({
      propertyId: id,
      unitNumber: "A3",
      active: false,
      status: "vacant",
    });

    const nairobi = await listProperties(admin, { county: "Nairobi" });
    expect(nairobi.items).toHaveLength(1);
    expect(nairobi.items[0].unitCount).toBe(2);
    expect(nairobi.items[0].occupiedCount).toBe(1);
  });

  it("paginates with a cursor", async () => {
    await createProperty(admin, input({ name: "Alpha Court" }));
    await createProperty(admin, input({ name: "Bravo Court" }));
    await createProperty(admin, input({ name: "Charlie Court" }));

    const first = await listProperties(admin, { pageSize: 2 });
    expect(first.items.map((item) => item.name)).toEqual([
      "Alpha Court",
      "Bravo Court",
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = await listProperties(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.name)).toEqual(["Charlie Court"]);
    expect(second.nextCursor).toBeNull();
  });

  it("searches over name, address and county", async () => {
    await createProperty(admin, input());
    await createProperty(
      admin,
      input({
        name: "Nyali Beach Court",
        address: "Off Link Road, Nyali",
        county: "Mombasa",
      }),
    );

    expect((await listProperties(admin, { q: "wood" })).items).toHaveLength(1);
    expect((await listProperties(admin, { q: "mombasa" })).items).toHaveLength(1);
    expect((await listProperties(admin, { q: "court" })).items).toHaveLength(1);
  });

  it("returns not_found and forbidden for detail reads", async () => {
    const id = await createProperty(admin, input({ managerIds: [manager.uid] }));

    await expect(
      getProperty(actor("property_manager", [id], manager.uid), id),
    ).resolves.toMatchObject({ id });
    await expect(getProperty(otherManager, id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getProperty(admin, "missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("only lists active properties in pickers", async () => {
    const active = await createProperty(admin, input({ managerIds: [manager.uid] }));
    const archived = await createProperty(
      admin,
      input({ name: "Old Court", managerIds: [manager.uid] }),
    );
    await archiveProperty(admin, archived, "No longer managed");

    const options = await getPropertyOptions(
      actor("property_manager", [active, archived], manager.uid),
    );
    expect(options.map((option) => option.id)).toEqual([active]);
  });

  it("refuses an empty scope instead of returning everything", async () => {
    await createProperty(admin, input());
    await expect(listProperties(manager, {})).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
