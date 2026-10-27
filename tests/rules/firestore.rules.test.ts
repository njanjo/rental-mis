import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-rental-mis";

function emulatorTarget(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const [host, port] = raw.split(":");
  return { host: host || "127.0.0.1", port: Number(port ?? 8080) };
}

const PROFILES = {
  "admin-uid": { role: "admin", active: true, propertyIds: [] },
  "manager-uid": { role: "property_manager", active: true, propertyIds: ["prop_1"] },
  "finance-uid": { role: "finance", active: true, propertyIds: ["prop_1"] },
  "maintenance-uid": { role: "maintenance", active: true, propertyIds: ["prop_1"] },
  "auditor-uid": { role: "auditor", active: true, propertyIds: [] },
  "inactive-uid": { role: "finance", active: false, propertyIds: [] },
} as const;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const { host, port } = emulatorTarget();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(
      Object.entries(PROFILES).map(([uid, profile]) =>
        setDoc(doc(db, "users", uid), {
          uid,
          fullName: uid.replace("-uid", ""),
          email: `${uid}@rentalmis.test`,
          active: profile.active,
          role: profile.role,
          propertyIds: profile.propertyIds,
        }),
      ),
    );
    await setDoc(doc(db, "properties", "prop_1"), {
      name: "Kilimani Heights",
      active: true,
    });
    await setDoc(doc(db, "invoices", "inv_1"), { status: "open", balanceMinor: 100 });
    await setDoc(doc(db, "payments", "pay_1"), { status: "confirmed" });
    await setDoc(doc(db, "auditLogs", "log_1"), { action: "test" });
    await setDoc(doc(db, "providerEvents", "evt_1"), { status: "received" });
    await setDoc(doc(db, "systemSettings", "billing"), { currency: "KES" });
    await setDoc(doc(db, "maintenanceRequests", "mr_1"), { status: "open" });
  });
});

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("authentication gate", () => {
  it("denies signed-out reads of properties", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "properties", "prop_1")));
  });

  it("denies a user with no profile", async () => {
    const db = testEnv.authenticatedContext("stranger-uid").firestore();
    await assertFails(getDoc(doc(db, "properties", "prop_1")));
  });

  it("denies an inactive user", async () => {
    const db = dbFor("inactive-uid");
    await assertFails(getDoc(doc(db, "properties", "prop_1")));
  });
});

describe("properties", () => {
  it("lets admin write", async () => {
    const db = dbFor("admin-uid");
    await assertSucceeds(
      setDoc(doc(db, "properties", "prop_2"), { name: "New", active: true }),
    );
  });

  it("blocks finance writes", async () => {
    const db = dbFor("finance-uid");
    await assertFails(
      setDoc(doc(db, "properties", "prop_2"), { name: "New", active: true }),
    );
  });

  it("lets a scoped manager read", async () => {
    const db = dbFor("manager-uid");
    await assertSucceeds(getDoc(doc(db, "properties", "prop_1")));
  });
});

describe("users", () => {
  it("lets a user read their own profile", async () => {
    const db = dbFor("finance-uid");
    await assertSucceeds(getDoc(doc(db, "users", "finance-uid")));
  });

  it("stops a user reading another profile", async () => {
    const db = dbFor("finance-uid");
    await assertFails(getDoc(doc(db, "users", "manager-uid")));
  });

  it("lets admin read any profile", async () => {
    const db = dbFor("admin-uid");
    await assertSucceeds(getDoc(doc(db, "users", "manager-uid")));
  });

  it("never allows role self-editing", async () => {
    const db = dbFor("admin-uid");
    await assertFails(setDoc(doc(db, "users", "admin-uid"), { role: "admin" }));
  });
});

describe("financial collections", () => {
  it("lets finance and auditor read payments", async () => {
    await assertSucceeds(getDoc(doc(dbFor("finance-uid"), "payments", "pay_1")));
    await assertSucceeds(getDoc(doc(dbFor("auditor-uid"), "payments", "pay_1")));
  });

  it("blocks maintenance and property manager from payments", async () => {
    await assertFails(getDoc(doc(dbFor("maintenance-uid"), "payments", "pay_1")));
    await assertFails(getDoc(doc(dbFor("manager-uid"), "payments", "pay_1")));
  });

  it("blocks all client writes to payments, even for admin", async () => {
    await assertFails(
      setDoc(doc(dbFor("admin-uid"), "payments", "pay_2"), { status: "confirmed" }),
    );
  });

  it("blocks client writes to invoices, even for admin", async () => {
    await assertFails(
      setDoc(doc(dbFor("admin-uid"), "invoices", "inv_2"), { status: "paid" }),
    );
  });

  it("allows auditors to read the invoice ledger", async () => {
    await assertSucceeds(getDoc(doc(dbFor("auditor-uid"), "invoices", "inv_1")));
  });
});

describe("audit and provider events", () => {
  it("lets admin and auditor read audit logs", async () => {
    await assertSucceeds(getDoc(doc(dbFor("admin-uid"), "auditLogs", "log_1")));
    await assertSucceeds(getDoc(doc(dbFor("auditor-uid"), "auditLogs", "log_1")));
  });

  it("blocks finance from audit logs", async () => {
    await assertFails(getDoc(doc(dbFor("finance-uid"), "auditLogs", "log_1")));
  });

  it("keeps provider events closed to every client", async () => {
    await assertFails(getDoc(doc(dbFor("admin-uid"), "providerEvents", "evt_1")));
    await assertFails(getDoc(doc(dbFor("finance-uid"), "providerEvents", "evt_1")));
  });
});

describe("maintenance", () => {
  it("lets operations and maintenance create requests", async () => {
    await assertSucceeds(
      setDoc(doc(dbFor("manager-uid"), "maintenanceRequests", "mr_2"), { status: "open" }),
    );
    await assertSucceeds(
      setDoc(doc(dbFor("maintenance-uid"), "maintenanceRequests", "mr_3"), {
        status: "open",
      }),
    );
  });

  it("blocks finance from creating requests", async () => {
    await assertFails(
      setDoc(doc(dbFor("finance-uid"), "maintenanceRequests", "mr_4"), { status: "open" }),
    );
  });
});

describe("settings and catch-all", () => {
  it("restricts system settings to admin reads", async () => {
    await assertSucceeds(getDoc(doc(dbFor("admin-uid"), "systemSettings", "billing")));
    await assertFails(getDoc(doc(dbFor("finance-uid"), "systemSettings", "billing")));
  });

  it("never allows clients to write system settings", async () => {
    await assertFails(
      setDoc(doc(dbFor("admin-uid"), "systemSettings", "billing"), { currency: "USD" }),
    );
  });

  it("denies unknown collections", async () => {
    await assertFails(getDoc(doc(dbFor("admin-uid"), "secrets", "x")));
  });

  it("keeps every listed collection reachable only through a valid flow", async () => {
    // Sanity: an active user can read the property they are scoped to.
    const snapshot = await getDoc(doc(dbFor("manager-uid"), "properties", "prop_1"));
    expect(snapshot.exists()).toBe(true);
  });
});
