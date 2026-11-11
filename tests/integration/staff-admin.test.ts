import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";
import type {
  StaffInviteInput,
  StaffRoleScopeInput,
} from "@/lib/validation/settings";
import {
  inviteStaff,
  listStaff,
  setStaffActive,
  updateStaffRoleScope,
} from "@/services/staff-admin";

const db = () => adminDb();
const auth = () => adminAuth();
const ACCOUNT = "acc_demo";

function actor(role: Role, uid = `uid_${role}`): SessionUser {
  return {
    uid,
    email: `${uid}@rentalmis.test`,
    fullName: uid,
    role,
    accountId: ACCOUNT,
    active: true,
    propertyIds: [],
  };
}

const admin = actor("admin");

function inviteInput(
  overrides: Partial<StaffInviteInput> = {},
): StaffInviteInput {
  return {
    fullName: "Grace Wanjiru",
    email: "grace@example.com",
    role: "property_manager",
    phoneE164: undefined,
    propertyIds: ["prop_a"],
    ...overrides,
  };
}

function scopeInput(
  overrides: Partial<StaffRoleScopeInput> = {},
): StaffRoleScopeInput {
  return {
    role: "property_manager",
    propertyIds: [],
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
      accountId: ACCOUNT,
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
      accountId: ACCOUNT,
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

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

async function profileOf(uid: string) {
  return (await db().collection("users").doc(uid).get()).data();
}

async function managerIds(propertyId: string): Promise<string[]> {
  const data = (await db().collection("properties").doc(propertyId).get())
    .data();
  return (data?.managerIds as string[]) ?? [];
}

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    ["properties", "auditLogs", "users"].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );

  // invite / setStaffActive touch Firebase Auth too: clear every user so
  // invites start from a clean slate and adoptions are deterministic.
  const listed = await auth().listUsers(1000);
  await Promise.all(listed.users.map((user) => auth().deleteUser(user.uid)));

  await seedProperty("prop_a", { name: "Kilimani Heights" });
  await seedProperty("prop_b", { name: "Nyali Beach Court" });
  await seedProperty("prop_arch", { name: "Old Court", active: false });
  await seedUser(admin);

  // The acting administrator also exists in Auth so toggling the account
  // (disable/enable) can be observed.
  await auth().createUser({
    uid: admin.uid,
    email: admin.email,
    password: "seed-admin-password",
  });
});

describe("inviteStaff", () => {
  it("provisions a property manager and audits the invite", async () => {
    const result = await inviteStaff(
      admin,
      inviteInput({ phoneE164: "+254712345678" }),
    );

    expect(result.uid).toBeTruthy();
    expect(result.adopted).toBe(false);
    expect(result.password).toMatch(/^[A-Za-z0-9!@#$%*]{18}$/);

    expect(await profileOf(result.uid)).toMatchObject({
      uid: result.uid,
      accountId: ACCOUNT,
      fullName: "Grace Wanjiru",
      email: "grace@example.com",
      role: "property_manager",
      propertyIds: ["prop_a"],
      phoneE164: "+254712345678",
      active: true,
    });

    expect(await auditActions(result.uid)).toContain("staff.invited");

    const user = await auth().getUser(result.uid);
    expect(user.email).toBe("grace@example.com");
    expect(user.customClaims).toMatchObject({ role: "property_manager" });
  });

  it("ignores property scope for administrators", async () => {
    const result = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Peter Boss",
        email: "boss@example.com",
        role: "admin",
        propertyIds: ["prop_a", "prop_b"],
      }),
    );

    expect(await profileOf(result.uid)).toMatchObject({
      role: "admin",
      propertyIds: [],
      active: true,
    });
    expect((await auth().getUser(result.uid)).customClaims).toMatchObject({
      role: "admin",
    });
  });

  it("refuses a duplicate email with a conflict", async () => {
    await inviteStaff(admin, inviteInput());
    await expect(
      inviteStaff(admin, inviteInput({ fullName: "Someone Else" })),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      inviteStaff(admin, inviteInput({ fullName: "Someone Else" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects unknown and archived properties", async () => {
    await expect(
      inviteStaff(admin, inviteInput({ propertyIds: ["prop_nope"] })),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      inviteStaff(admin, inviteInput({ propertyIds: ["prop_arch"] })),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("rejects an invalid phone before provisioning anything", async () => {
    await expect(
      inviteStaff(admin, inviteInput({ phoneE164: "0712 34" })),
    ).rejects.toMatchObject({ code: "validation" });

    const snapshot = await db()
      .collection("users")
      .where("email", "==", "grace@example.com")
      .get();
    expect(snapshot.empty).toBe(true);
    await expect(auth().getUserByEmail("grace@example.com")).rejects.toThrow();
  });

  it("adopts an orphan auth user and reuses its uid", async () => {
    const orphan = await auth().createUser({
      email: "orphan@example.com",
      password: "orphan-original-password",
    });

    const result = await inviteStaff(
      admin,
      inviteInput({ email: "orphan@example.com" }),
    );

    expect(result.adopted).toBe(true);
    expect(result.uid).toBe(orphan.uid);
    expect(await profileOf(orphan.uid)).toMatchObject({
      email: "orphan@example.com",
      role: "property_manager",
      accountId: ACCOUNT,
      active: true,
    });
    expect(await auditActions(orphan.uid)).toContain("staff.invited");

    // Adoption re-points the auth account at the new credentials.
    const user = await auth().getUser(orphan.uid);
    expect(user.displayName).toBe("Grace Wanjiru");
    expect(user.customClaims).toMatchObject({ role: "property_manager" });
  });
});

describe("updateStaffRoleScope", () => {
  it("refuses self-edits", async () => {
    await expect(
      updateStaffRoleScope(admin, admin.uid, scopeInput({ role: "finance" })),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("promotes to property manager, joins the property and audits the role", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Faith Mwikali",
        email: "faith@example.com",
        role: "finance",
        propertyIds: [],
      }),
    );

    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "property_manager", propertyIds: ["prop_a"] }),
    );

    expect(await profileOf(invited.uid)).toMatchObject({
      role: "property_manager",
      propertyIds: ["prop_a"],
    });
    expect(await managerIds("prop_a")).toEqual([invited.uid]);
    expect(await managerIds("prop_b")).toEqual([]);

    const logs = await db()
      .collection("auditLogs")
      .where("entityId", "==", invited.uid)
      .where("action", "==", "staff.role_updated")
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().before).toEqual({
      role: "finance",
      propertyIds: [],
    });
    expect(logs.docs[0].data().after).toEqual({
      role: "property_manager",
      propertyIds: ["prop_a"],
    });

    expect((await auth().getUser(invited.uid)).customClaims).toMatchObject({
      role: "property_manager",
    });
  });

  it("moves scope between properties and audits the scope change", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Faith Mwikali",
        email: "faith@example.com",
        role: "finance",
        propertyIds: [],
      }),
    );
    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "property_manager", propertyIds: ["prop_a"] }),
    );

    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "property_manager", propertyIds: ["prop_b"] }),
    );

    expect(await profileOf(invited.uid)).toMatchObject({
      propertyIds: ["prop_b"],
    });
    expect(await managerIds("prop_a")).toEqual([]);
    expect(await managerIds("prop_b")).toEqual([invited.uid]);

    const logs = await db()
      .collection("auditLogs")
      .where("entityId", "==", invited.uid)
      .where("action", "==", "staff.scope_updated")
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().before).toEqual({
      role: "property_manager",
      propertyIds: ["prop_a"],
    });
    expect(logs.docs[0].data().after).toEqual({
      role: "property_manager",
      propertyIds: ["prop_b"],
    });
  });

  it("clears scope and membership when promoted to administrator", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Faith Mwikali",
        email: "faith@example.com",
        role: "finance",
        propertyIds: [],
      }),
    );
    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "property_manager", propertyIds: ["prop_a"] }),
    );
    expect(await managerIds("prop_a")).toEqual([invited.uid]);

    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "admin", propertyIds: ["prop_a"] }),
    );

    expect(await profileOf(invited.uid)).toMatchObject({
      role: "admin",
      propertyIds: [],
    });
    expect(await managerIds("prop_a")).toEqual([]);
  });

  it("refuses changes to an inactive staff member", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Faith Mwikali",
        email: "faith@example.com",
      }),
    );
    await setStaffActive(admin, invited.uid, false, "Left the agency");

    await expect(
      updateStaffRoleScope(admin, invited.uid, scopeInput({ role: "finance" })),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(await profileOf(invited.uid)).toMatchObject({
      role: "property_manager",
      propertyIds: ["prop_a"],
    });
  });
});

describe("setStaffActive", () => {
  it("refuses self-deactivation", async () => {
    await expect(
      setStaffActive(admin, admin.uid, false, "Bye"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses to deactivate the account's last active administrator", async () => {
    // A second administrator is invited and offboarded; their stale session
    // must not be able to remove the account's only active administrator.
    const offboarded = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Peter Boss",
        email: "offboarded@example.com",
        role: "admin",
        propertyIds: [],
      }),
    );
    await setStaffActive(admin, offboarded.uid, false, "Left the agency");

    const staleSession = actor("admin", offboarded.uid);
    await expect(
      setStaffActive(staleSession, admin.uid, false, "Hostile takeover"),
    ).rejects.toMatchObject({ code: "conflict" });

    expect((await profileOf(admin.uid))?.active).toBe(true);
  });

  it("deactivates the first administrator once a second one is active, then reactivates", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({
        fullName: "Peter Boss",
        email: "successor@example.com",
      }),
    );
    // Promote the invitee so the account keeps an active administrator.
    await updateStaffRoleScope(
      admin,
      invited.uid,
      scopeInput({ role: "admin", propertyIds: [] }),
    );
    const successor = actor("admin", invited.uid);

    await setStaffActive(successor, admin.uid, false, "Founder stepped down");

    expect((await profileOf(admin.uid))?.active).toBe(false);
    const log = await db()
      .collection("auditLogs")
      .where("entityId", "==", admin.uid)
      .where("action", "==", "staff.deactivated")
      .get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data().reason).toBe("Founder stepped down");
    expect((await auth().getUser(admin.uid)).disabled).toBe(true);

    await setStaffActive(successor, admin.uid, true, "Back from sabbatical");

    expect((await profileOf(admin.uid))?.active).toBe(true);
    expect(await auditActions(admin.uid)).toContain("staff.reactivated");
    expect((await auth().getUser(admin.uid)).disabled).toBe(false);
  });
});

describe("listStaff", () => {
  it("lists account staff with resolved property names", async () => {
    const invited = await inviteStaff(
      admin,
      inviteInput({ propertyIds: ["prop_a", "prop_b"] }),
    );

    // Staff of another account must never leak into the list.
    await db()
      .collection("users")
      .doc("uid_other_account")
      .set({
        uid: "uid_other_account",
        accountId: "acc_other",
        fullName: "Jane Elsewhere",
        email: "jane@elsewhere.test",
        role: "admin",
        propertyIds: [],
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    const staff = await listStaff(admin);
    expect(staff).toHaveLength(2);
    expect(staff.map((member) => member.uid)).toEqual(
      expect.arrayContaining([admin.uid, invited.uid]),
    );

    const seeded = staff.find((member) => member.uid === admin.uid);
    expect(seeded).toMatchObject({
      fullName: "uid_admin",
      role: "admin",
      active: true,
      propertyIds: [],
      propertyNames: [],
    });

    const manager = staff.find((member) => member.uid === invited.uid);
    expect(manager).toMatchObject({
      fullName: "Grace Wanjiru",
      email: "grace@example.com",
      role: "property_manager",
      active: true,
      propertyIds: ["prop_a", "prop_b"],
      propertyNames: ["Kilimani Heights", "Nyali Beach Court"],
    });
  });
});
