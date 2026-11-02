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
  "auditor-uid": { role: "auditor", active: true, propertyIds: [] },
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
  });
});

function dbFor(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("otpChallenges", () => {
  it("is unreachable by any client, including admin", async () => {
    await assertFails(
      getDoc(doc(dbFor("admin-uid"), "otpChallenges", "challenge_1")),
    );
    await assertFails(
      getDoc(doc(dbFor("finance-uid"), "otpChallenges", "challenge_1")),
    );
  });

  it("blocks signed-out reads", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "otpChallenges", "challenge_1")));
  });

  it("blocks client writes, even for admin", async () => {
    await assertFails(
      setDoc(doc(dbFor("admin-uid"), "otpChallenges", "challenge_1"), {
        codeHash: "deadbeef",
      }),
    );
  });

  it("is invisible to unauthenticated writes", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "otpChallenges", "challenge_2"), { codeHash: "cafe" }),
    );
  });
});