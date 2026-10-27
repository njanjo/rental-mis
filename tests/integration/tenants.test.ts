import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import type {
  TenantCreateInput,
  TenantUpdateInput,
} from "@/lib/validation/tenant";
import {
  createTenant,
  getTenant,
  getTenantOptions,
  listTenants,
  setTenantStatus,
  updateTenant,
} from "@/services/tenants";

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

function createInput(overrides: Partial<TenantCreateInput> = {}): TenantCreateInput {
  return {
    propertyId: "prop_1",
    fullName: "Grace Wanjiru",
    phone: "+254712345678",
    nationalIdLast4: "4821",
    consentSms: true,
    notes: undefined,
    ...overrides,
  };
}

function updateInput(overrides: Partial<TenantUpdateInput> = {}): TenantUpdateInput {
  return {
    fullName: overrides.fullName ?? "Grace Wanjiru",
    phone: overrides.phone ?? "+254712345678",
    nationalIdLast4: overrides.nationalIdLast4 ?? "4821",
    consentSms: overrides.consentSms ?? true,
    notes: overrides.notes,
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

async function seedLease(
  id: string,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("leases")
    .doc(id)
    .set({
      tenantId,
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

describe("createTenant", () => {
  it("creates the tenant, the phone index and an audit entry", async () => {
    const id = await createTenant(
      manager,
      createInput({ notes: "Works at the hospital" }),
    );

    const data = (await db().collection("tenants").doc(id).get()).data();
    expect(data?.fullName).toBe("Grace Wanjiru");
    expect(data?.fullNameLower).toBe("grace wanjiru");
    expect(data?.phoneE164).toBe("+254712345678");
    expect(data?.status).toBe("active");
    expect(data?.consentSms).toBe(true);
    expect(data?.propertyIds).toEqual(["prop_1"]);
    expect(data?.createdBy).toBe(manager.uid);
    expect(data?.notes).toBe("Works at the hospital");

    const phone = (
      await db().collection("tenantPhones").doc("+254712345678").get()
    ).data();
    expect(phone?.tenantId).toBe(id);
    expect(phone?.active).toBe(true);
    expect(await auditActions(id)).toContain("tenant.created");
  });

  it("rejects a phone number that already belongs to an active tenant", async () => {
    await createTenant(admin, createInput());
    await expect(
      createTenant(admin, createInput({ fullName: "Someone Else" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("reuses a released phone number", async () => {
    await createTenant(admin, createInput());
    await db()
      .collection("tenantPhones")
      .doc("+254712345678")
      .update({ active: false });

    await expect(
      createTenant(admin, createInput({ fullName: "Someone Else" })),
    ).resolves.toBeTruthy();
  });

  it("refuses an archived property and an out-of-scope manager", async () => {
    await seedProperty("prop_closed", { active: false });
    await expect(
      createTenant(admin, createInput({ propertyId: "prop_closed" })),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(createTenant(otherManager, createInput())).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses roles without manage_tenants", async () => {
    await expect(createTenant(actor("finance"), createInput())).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("updateTenant", () => {
  it("updates details and keeps the phone index in step", async () => {
    const id = await createTenant(admin, createInput());

    await updateTenant(admin, id, updateInput({
      fullName: "Grace W. Kamau",
      phone: "+254700111222",
      consentSms: false,
      notes: "Prefers calls after 5pm",
    }));

    const data = (await db().collection("tenants").doc(id).get()).data();
    expect(data?.fullName).toBe("Grace W. Kamau");
    expect(data?.fullNameLower).toBe("grace w. kamau");
    expect(data?.phoneE164).toBe("+254700111222");
    expect(data?.consentSms).toBe(false);
    expect(data?.optedOutAt).toBeTruthy();

    const oldPhone = (
      await db().collection("tenantPhones").doc("+254712345678").get()
    ).data();
    expect(oldPhone?.active).toBe(false);

    const newPhone = (
      await db().collection("tenantPhones").doc("+254700111222").get()
    ).data();
    expect(newPhone?.tenantId).toBe(id);
    expect(newPhone?.active).toBe(true);

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "tenant.updated")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().before?.phoneE164).toBe("+254712345678");
    expect(log.docs[0].data().after?.phoneE164).toBe("+254700111222");
  });

  it("clears the opt-out timestamp when consent returns", async () => {
    const id = await createTenant(admin, createInput({ consentSms: false }));
    expect((await db().collection("tenants").doc(id).get()).data()?.optedOutAt).toBeTruthy();

    await updateTenant(admin, id, updateInput({ consentSms: true }));
    expect(
      (await db().collection("tenants").doc(id).get()).data()?.optedOutAt,
    ).toBeUndefined();
  });

  it("rejects a phone already used by another tenant", async () => {
    await createTenant(admin, createInput());
    const other = await createTenant(
      admin,
      createInput({ fullName: "Peter Otieno", phone: "+254723456789" }),
    );

    await expect(
      updateTenant(admin, other, updateInput({ phone: "+254712345678" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("blocks a manager outside the tenant's properties", async () => {
    const id = await createTenant(admin, createInput());
    await expect(
      updateTenant(otherManager, id, updateInput({ fullName: "Hijacked" })),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns not_found for a missing tenant", async () => {
    await expect(
      updateTenant(admin, "missing", updateInput()),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("setTenantStatus", () => {
  it("changes status with a reason and audits it", async () => {
    const id = await createTenant(admin, createInput());

    await setTenantStatus(admin, id, "inactive", "Tenant asked for a pause");

    const data = (await db().collection("tenants").doc(id).get()).data();
    expect(data?.status).toBe("inactive");

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "tenant.status_changed")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().reason).toBe("Tenant asked for a pause");
  });

  it("refuses to leave active while a lease is running", async () => {
    const id = await createTenant(admin, createInput());
    await seedLease("lease_1", id);
    await db().collection("tenants").doc(id).update({ currentLeaseId: "lease_1" });

    await expect(
      setTenantStatus(admin, id, "former", "Moved out"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects an unchanged status", async () => {
    const id = await createTenant(admin, createInput());
    await expect(
      setTenantStatus(admin, id, "active", "No change"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("blocks a manager outside the tenant's properties", async () => {
    const id = await createTenant(admin, createInput());
    await expect(
      setTenantStatus(otherManager, id, "former", "Moved out"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("tenant queries", () => {
  it("scopes lists to shared properties or records the actor created", async () => {
    const mine = await createTenant(admin, createInput());
    const theirs = await createTenant(
      admin,
      createInput({ propertyId: "prop_2", fullName: "Peter Otieno", phone: "+254723456789" }),
    );
    const createdByManager = await createTenant(manager, createInput({
      fullName: "Created By Manager",
      phone: "+254733333333",
    }));

    const scoped = await listTenants(manager, {});
    expect(scoped.items.map((item) => item.id).sort()).toEqual(
      [mine, createdByManager].sort(),
    );

    const all = await listTenants(admin, {});
    expect(all.items.map((item) => item.id).sort()).toEqual(
      [mine, theirs, createdByManager].sort(),
    );
  });

  it("filters by property and status and searches name or phone", async () => {
    const mine = await createTenant(admin, createInput());
    await createTenant(admin, createInput({
      propertyId: "prop_2",
      fullName: "Peter Otieno",
      phone: "+254723456789",
    }));
    await setTenantStatus(admin, mine, "inactive", "Temporary relocation");

    expect((await listTenants(admin, { propertyId: "prop_1" })).items).toHaveLength(1);
    expect((await listTenants(admin, { status: "active" })).items).toHaveLength(1);
    expect((await listTenants(admin, { q: "otieno" })).items).toHaveLength(1);
    expect((await listTenants(admin, { q: "0712" })).items.map((item) => item.id)).toEqual([
      mine,
    ]);
  });

  it("paginates with a cursor", async () => {
    await createTenant(admin, createInput({ fullName: "Alpha Tenant", phone: "+254711111111" }));
    await createTenant(admin, createInput({ fullName: "Bravo Tenant", phone: "+254722222222" }));
    await createTenant(admin, createInput({ fullName: "Charlie Tenant", phone: "+254733333333" }));

    const first = await listTenants(admin, { pageSize: 2 });
    expect(first.items.map((item) => item.fullName)).toEqual([
      "Alpha Tenant",
      "Bravo Tenant",
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = await listTenants(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.fullName)).toEqual(["Charlie Tenant"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns not_found and forbidden for detail reads", async () => {
    const id = await createTenant(admin, createInput());

    await expect(getTenant(manager, id)).resolves.toMatchObject({ id });
    await expect(getTenant(otherManager, id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getTenant(admin, "missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("only offers active tenants in pickers", async () => {
    const active = await createTenant(admin, createInput());
    const former = await createTenant(
      admin,
      createInput({ fullName: "Former Tenant", phone: "+254744444444" }),
    );
    await setTenantStatus(admin, former, "former", "Moved out");

    const options = await getTenantOptions(admin);
    expect(options.map((option) => option.id)).toEqual([active]);
  });

  it("refuses an empty scope instead of returning everything", async () => {
    await createTenant(admin, createInput());
    await expect(
      listTenants(actor("property_manager", [], "uid_empty"), {}),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
