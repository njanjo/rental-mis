import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import type {
  MaintenanceCreateInput,
  MaintenanceUpdateInput,
} from "@/lib/validation/maintenance";
import {
  createMaintenance,
  getMaintenance,
  listMaintenance,
  updateMaintenance,
} from "@/services/maintenance";

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
const maintenance = actor("maintenance", ["prop_1"], "uid_maintenance");
const otherMaintenance = actor(
  "maintenance",
  ["prop_2"],
  "uid_other_maintenance",
);
const finance = actor("finance", ["prop_1"], "uid_finance");

function createInput(
  overrides: Partial<MaintenanceCreateInput> = {},
): MaintenanceCreateInput {
  return {
    propertyId: "prop_1",
    unitId: "unit_1",
    title: "Leaking kitchen sink",
    issue: "Kitchen sink leaking under the cabinet",
    priority: "high",
    assignedTo: undefined,
    ...overrides,
  };
}

function updateInput(
  overrides: Partial<MaintenanceUpdateInput> = {},
): MaintenanceUpdateInput {
  return {
    status: "assigned",
    priority: "high",
    assignedTo: undefined,
    note: undefined,
    ...overrides,
  };
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

async function seedRequest(
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection("maintenanceRequests")
    .doc(id)
    .set({
      propertyId: "prop_1",
      unitId: "unit_1",
      title: "Leaking kitchen sink",
      issue: "Kitchen sink leaking under the cabinet",
      priority: "high",
      status: "open",
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...overrides,
    });
}

function requestData(id: string) {
  return db()
    .collection("maintenanceRequests")
    .doc(id)
    .get()
    .then((doc) => doc.data());
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
  await seedUser(maintenance, { fullName: "Dennis Mutua" });
  await seedUser(otherMaintenance, { fullName: "Other Fixer" });
  await seedUser(finance);
  await seedProperty("prop_1");
  await seedProperty("prop_2");
  await seedUnit("unit_1");
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
      "maintenanceRequests",
    ].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );
});

describe("createMaintenance", () => {
  it("creates an open request and audits it", async () => {
    await seedPortfolio();

    const id = await createMaintenance(manager, createInput());

    const request = await requestData(id);
    expect(request?.propertyId).toBe("prop_1");
    expect(request?.unitId).toBe("unit_1");
    expect(request?.title).toBe("Leaking kitchen sink");
    expect(request?.priority).toBe("high");
    expect(request?.status).toBe("open");
    expect(request?.createdBy).toBe("uid_manager");
    expect(request?.assignedTo).toBeUndefined();
    expect(await auditActions(id)).toContain("maintenance.created");
  });

  it("assigns at creation and moves straight to assigned", async () => {
    await seedPortfolio();

    const id = await createMaintenance(
      manager,
      createInput({ assignedTo: "uid_maintenance" }),
    );

    const request = await requestData(id);
    expect(request?.status).toBe("assigned");
    expect(request?.assignedTo).toBe("uid_maintenance");
    expect(request?.assignedToName).toBe("Dennis Mutua");
  });

  it("rejects a unit from another property, an archived unit or property", async () => {
    await seedPortfolio();
    await seedUnit("unit_2", { propertyId: "prop_2" });

    await expect(
      createMaintenance(manager, createInput({ unitId: "unit_2" })),
    ).rejects.toMatchObject({ code: "validation" });

    await seedUnit("unit_closed", { active: false });
    await expect(
      createMaintenance(manager, createInput({ unitId: "unit_closed" })),
    ).rejects.toMatchObject({ code: "conflict" });

    await seedProperty("prop_closed", { active: false });
    await seedUnit("unit_closed_prop", { propertyId: "prop_closed" });
    await expect(
      createMaintenance(
        admin,
        createInput({ propertyId: "prop_closed", unitId: "unit_closed_prop" }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces scope and the manage capability", async () => {
    await seedPortfolio();

    await expect(
      createMaintenance(otherManager, createInput()),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createMaintenance(maintenance, createInput()),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(createMaintenance(manager, createInput())).resolves.toBeTruthy();
  });

  it("only assigns active staff who work on the property", async () => {
    await seedPortfolio();

    await expect(
      createMaintenance(
        manager,
        createInput({ assignedTo: "uid_other_maintenance" }),
      ),
    ).rejects.toMatchObject({ code: "validation" });

    await expect(
      createMaintenance(manager, createInput({ assignedTo: "uid_finance" })),
    ).rejects.toMatchObject({ code: "validation" });

    await db()
      .collection("users")
      .doc("uid_maintenance")
      .update({ active: false });
    await expect(
      createMaintenance(manager, createInput({ assignedTo: "uid_maintenance" })),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("returns not_found for a missing property or unit", async () => {
    await seedPortfolio();

    await expect(
      createMaintenance(admin, createInput({ unitId: "unit_missing" })),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      createMaintenance(
        admin,
        createInput({ propertyId: "prop_missing", unitId: "unit_1" }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("updateMaintenance", () => {
  it("assigns, starts and resolves work with before/after audit", async () => {
    await seedPortfolio();
    const id = await createMaintenance(manager, createInput());

    await updateMaintenance(
      manager,
      id,
      updateInput({ status: "assigned", assignedTo: "uid_maintenance" }),
    );
    expect((await requestData(id))?.status).toBe("assigned");
    expect((await requestData(id))?.assignedTo).toBe("uid_maintenance");

    await updateMaintenance(
      maintenance,
      id,
      updateInput({
        status: "in_progress",
        assignedTo: "uid_maintenance",
        note: "Ordered a new trap.",
      }),
    );
    expect((await requestData(id))?.status).toBe("in_progress");

    await updateMaintenance(
      maintenance,
      id,
      updateInput({
        status: "resolved",
        assignedTo: "uid_maintenance",
        note: "Replaced the trap and sealed the joint.",
      }),
    );

    const request = await requestData(id);
    expect(request?.status).toBe("resolved");
    expect(request?.resolutionNote).toBe(
      "Replaced the trap and sealed the joint.",
    );
    expect(request?.resolvedAt).toBeTruthy();

    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", id)
      .where("action", "==", "maintenance.updated")
      .get();
    expect(log.size).toBe(3);
    const resolved = log.docs.find((doc) => doc.data().after?.status === "resolved");
    expect(resolved?.data().before?.status).toBe("in_progress");
    expect(resolved?.data().reason).toBe(
      "Replaced the trap and sealed the joint.",
    );
  });

  it("treats an assignee on an open request as an assignment", async () => {
    await seedPortfolio();
    await seedRequest("mr_1");

    await updateMaintenance(
      manager,
      "mr_1",
      updateInput({ status: "open", assignedTo: "uid_maintenance" }),
    );

    const request = await requestData("mr_1");
    expect(request?.status).toBe("assigned");
    expect(request?.assignedTo).toBe("uid_maintenance");
  });

  it("refuses skipped transitions and terminal requests", async () => {
    await seedPortfolio();
    await seedRequest("mr_1");

    await expect(
      updateMaintenance(
        manager,
        "mr_1",
        updateInput({
          status: "resolved",
          assignedTo: "uid_maintenance",
          note: "Trying to skip the queue.",
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    await seedRequest("mr_done", { status: "resolved" });
    await expect(
      updateMaintenance(manager, "mr_done", updateInput({ status: "resolved" })),
    ).rejects.toMatchObject({ code: "conflict" });

    await seedRequest("mr_cancelled", { status: "cancelled" });
    await expect(
      updateMaintenance(
        manager,
        "mr_cancelled",
        updateInput({ status: "cancelled" }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("requires an owner for active work and a note to resolve or cancel", async () => {
    await seedPortfolio();
    await seedRequest("mr_1");

    await expect(
      updateMaintenance(manager, "mr_1", updateInput({ status: "assigned" })),
    ).rejects.toMatchObject({ code: "validation" });

    await expect(
      updateMaintenance(
        manager,
        "mr_1",
        updateInput({ status: "cancelled" }),
      ),
    ).rejects.toMatchObject({ code: "validation" });

    await updateMaintenance(
      manager,
      "mr_1",
      updateInput({ status: "cancelled", note: "Duplicate report." }),
    );
    const request = await requestData("mr_1");
    expect(request?.status).toBe("cancelled");
    expect(request?.closedAt).toBeTruthy();
    expect(request?.resolutionNote).toBe("Duplicate report.");
  });

  it("lets maintenance staff progress work but not reassign it", async () => {
    await seedPortfolio();
    await seedRequest("mr_1", {
      status: "assigned",
      assignedTo: "uid_maintenance",
      assignedToName: "Dennis Mutua",
    });

    await updateMaintenance(
      maintenance,
      "mr_1",
      updateInput({
        status: "in_progress",
        assignedTo: "uid_maintenance",
        note: "On site now.",
      }),
    );
    expect((await requestData("mr_1"))?.status).toBe("in_progress");

    await expect(
      updateMaintenance(
        maintenance,
        "mr_1",
        updateInput({
          status: "in_progress",
          assignedTo: "uid_other_maintenance",
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("enforces scope, capability and not_found", async () => {
    await seedPortfolio();
    await seedRequest("mr_1");

    await expect(
      updateMaintenance(otherManager, "mr_1", updateInput({ status: "open" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateMaintenance(finance, "mr_1", updateInput({ status: "open" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateMaintenance(manager, "mr_missing", updateInput({ status: "open" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("maintenance queries", () => {
  it("scopes lists to the actor's properties and filters by status", async () => {
    await seedPortfolio();
    await seedUnit("unit_2", { propertyId: "prop_2" });
    await seedRequest("mr_p1_open", {
      createdAt: Timestamp.fromDate(new Date("2026-01-03T10:00:00Z")),
    });
    await seedRequest("mr_p1_done", {
      status: "resolved",
      createdAt: Timestamp.fromDate(new Date("2026-01-02T10:00:00Z")),
    });
    await seedRequest("mr_p2_open", {
      propertyId: "prop_2",
      unitId: "unit_2",
      createdAt: Timestamp.fromDate(new Date("2026-01-01T10:00:00Z")),
    });

    const scoped = await listMaintenance(maintenance, {});
    expect(scoped.items.map((request) => request.id)).toEqual([
      "mr_p1_open",
      "mr_p1_done",
    ]);

    const adminPage = await listMaintenance(admin, {});
    expect(adminPage.items.map((request) => request.id)).toEqual([
      "mr_p1_open",
      "mr_p1_done",
      "mr_p2_open",
    ]);

    const done = await listMaintenance(manager, { status: "resolved" });
    expect(done.items.map((request) => request.id)).toEqual(["mr_p1_done"]);

    await expect(
      listMaintenance(manager, { propertyId: "prop_2" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      listMaintenance(actor("maintenance", [], "uid_empty"), {}),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(listMaintenance(finance, {})).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("filters by priority and assignee and searches text", async () => {
    await seedPortfolio();
    await seedRequest("mr_leak", {
      title: "Leaking kitchen sink",
      priority: "high",
      status: "assigned",
      assignedTo: "uid_maintenance",
      assignedToName: "Dennis Mutua",
      createdAt: Timestamp.fromDate(new Date("2026-01-03T10:00:00Z")),
    });
    await seedRequest("mr_paint", {
      title: "Corridor paint peeling",
      issue: "Paint is peeling near the lift",
      priority: "medium",
      createdAt: Timestamp.fromDate(new Date("2026-01-02T10:00:00Z")),
    });

    const high = await listMaintenance(manager, { priority: "high" });
    expect(high.items.map((request) => request.id)).toEqual(["mr_leak"]);

    const assigned = await listMaintenance(manager, {
      assignedTo: "uid_maintenance",
    });
    expect(assigned.items.map((request) => request.id)).toEqual(["mr_leak"]);

    expect((await listMaintenance(manager, { q: "peeling" })).items).toHaveLength(1);
    expect((await listMaintenance(manager, { q: "mutua" })).items).toHaveLength(1);
    expect((await listMaintenance(manager, { q: "unit_1" })).items).toHaveLength(2);
    expect((await listMaintenance(manager, { q: "prop_1" })).items).toHaveLength(2);
    expect((await listMaintenance(manager, { q: "nothing" })).items).toHaveLength(0);
  });

  it("paginates with a cursor when no in-memory filter is active", async () => {
    await seedPortfolio();
    await seedRequest("mr_a", {
      createdAt: Timestamp.fromDate(new Date("2026-01-01T10:00:00Z")),
    });
    await seedRequest("mr_b", {
      createdAt: Timestamp.fromDate(new Date("2026-01-02T10:00:00Z")),
    });
    await seedRequest("mr_c", {
      createdAt: Timestamp.fromDate(new Date("2026-01-03T10:00:00Z")),
    });

    const first = await listMaintenance(admin, { pageSize: 2 });
    expect(first.items.map((request) => request.id)).toEqual(["mr_c", "mr_b"]);
    expect(first.nextCursor).toBe("mr_b");

    const second = await listMaintenance(admin, {
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((request) => request.id)).toEqual(["mr_a"]);
    expect(second.nextCursor).toBeNull();

    const filtered = await listMaintenance(admin, {
      pageSize: 1,
      priority: "high",
    });
    expect(filtered.nextCursor).toBeNull();
  });

  it("decorates details and returns not_found or forbidden", async () => {
    await seedPortfolio();
    await seedRequest("mr_1", {
      status: "assigned",
      assignedTo: "uid_maintenance",
      assignedToName: "Dennis Mutua",
    });

    const request = await getMaintenance(manager, "mr_1");
    expect(request.propertyName).toBe("prop_1");
    expect(request.unitNumber).toBe("UNIT_1");
    expect(request.assignedToName).toBe("Dennis Mutua");
    expect(request.createdByName).toBe("uid_admin");

    await expect(getMaintenance(manager, "mr_missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getMaintenance(otherManager, "mr_1")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
