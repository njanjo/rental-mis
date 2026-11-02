/**
 * Production staff provisioning (bootstrap runbook).
 *
 * The app admin-provisions staff accounts (docs/DECISIONS.md #4); the UI has
 * no staff-creation flow, so the first accounts are created here. Mirrors the
 * emulator seed's upsert pattern:
 *
 *     Auth user  -> custom claim { role } -> users/{uid} doc -> auditLogs entry
 *
 * Usage:
 *
 *   npx tsx scripts/provision-staff.ts \
 *     --project rental-mis-prod --confirm \
 *     --email you@example.com --name "Michael Njanjo" \
 *     --role admin
 *
 *   # rehearsal against local emulators (hosts are auto-set for demo-* ids):
 *   npx tsx scripts/provision-staff.ts \
 *     --project demo-rental-mis --confirm \
 *     --email admin@rentalmis.test --name "Local Admin"
 *
 * --password omitted -> a strong password is generated and printed ONCE.
 * Credentials reuse the app chain: FIREBASE_SERVICE_ACCOUNT (whole JSON file)
 * -> FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY -> ADC (emulator runs).
 */
import { initializeApp, cert, type AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";

import type { Role } from "../lib/types";

const ROLES: Role[] = ["admin", "property_manager", "finance", "maintenance", "auditor"];
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*";

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type Flags = {
  project?: string;
  confirm: boolean;
  email?: string;
  name?: string;
  role: Role;
  propertyIds: string[];
  password?: string;
  envFile?: string;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { confirm: false, role: "admin", propertyIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const hasValue = index + 1 < argv.length && !argv[index + 1].startsWith("--");
    const value = hasValue ? argv[index + 1] : undefined;
    if (hasValue) index += 1;

    switch (key) {
      case "--project": flags.project = value; break;
      case "--confirm": flags.confirm = true; break;
      case "--email": flags.email = value; break;
      case "--name": flags.name = value; break;
      case "--role": flags.role = (value ?? "admin") as Role; break;
      case "--property": {
        flags.propertyIds = (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
        break;
      }
      case "--password": flags.password = value; break;
      case "--env-file": flags.envFile = value; break;
      default: fail(`Unknown flag: ${key}`);
    }
  }
  return flags;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(__usage);
  process.exit(1);
}

const __usage =
  "\nUsage:\n" +
  "  npx tsx scripts/provision-staff.ts --project <project-id> --confirm \\\n" +
  "    --email <email> --name \"Full Name\" [--role admin] [--property id1,id2] [--password <pw>] [--env-file <file>]\n";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Optional.
}

const flags = parseFlags(process.argv.slice(2));

if (flags.envFile) {
  try {
    process.loadEnvFile?.(flags.envFile);
  } catch {
    fail(`Could not load env file: ${flags.envFile}`);
  }
}

const projectId = flags.project ?? process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  fail("No project id: pass --project <id> (or set FIREBASE_PROJECT_ID).");
}
const isDemoProject = projectId.startsWith("demo-");
if (!flags.confirm) {
  fail(
    `Refusing to touch project "${projectId}" without --confirm. ` +
      "This script writes real Auth users and Firestore documents.",
  );
}
if (!flags.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(flags.email)) {
  fail("A valid --email is required.");
}
if (!flags.name) {
  fail("--name \"Full Name\" is required (it becomes the users doc fullName).");
}
if (!ROLES.includes(flags.role)) {
  fail(`--role must be one of: ${ROLES.join(", ")}`);
}
if (process.env.CI) {
  fail(
    "CI detected. Provisioning is a local runbook command; the generated " +
      "password must never be printed into CI logs.",
  );
}

// Admins are global by design (docs/DECISIONS.md); property scoping is for
// every other role.
if (flags.role === "admin" && flags.propertyIds.length > 0) {
  console.warn("! --property ignored for admin accounts (admins are global).");
  flags.propertyIds = [];
}

// Writing a production project while the emulator hosts are set would route
// every write to the local emulator under a production project id.
if (!isDemoProject && (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  fail(
    "Emulator hosts are set (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST) " +
      `but the target project "${projectId}" is not a demo-* id. Unset them for production.`,
  );
}

if (isDemoProject) {
  // Same auto-routing the seed applies so rehearsals need no env setup.
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

// ---------------------------------------------------------------------------
// Credentials (mirrors lib/firebase/admin.ts buildApp without its server-only
// import, which throws outside the React server runtime)
// ---------------------------------------------------------------------------

function buildAppOptions(): AppOptions {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    let parsed: { project_id?: string; client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(serviceAccountJson);
    } catch {
      fail("FIREBASE_SERVICE_ACCOUNT is not valid JSON — paste the whole service-account file as-is.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      fail("FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key fields.");
    }
    return {
      credential: cert({
        projectId: parsed.project_id ?? projectId,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      }),
      projectId,
    };
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }

  // ADC — covers Google-hosted runtimes and emulator runs.
  return { projectId };
}

const app = initializeApp(buildAppOptions());
const auth = getAuth(app);
const db: Firestore = getFirestore(app);

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------

function generatePassword(length = 18): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let password = "";
  for (const byte of bytes) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return password;
}

let existed = false;

const preview = {
  project: projectId,
  email: flags.email,
  name: flags.name,
  role: flags.role,
  propertyIds: flags.propertyIds.length ? flags.propertyIds : "(admins/global: all)",
  authUser: "create-or-update",
};

console.log("Provisioning plan:");
console.table([preview]);

const password = flags.password ?? generatePassword();
if (!flags.password) {
  console.log("(no --password given -> a strong password was generated; it is printed once below)\n");
}

async function main(): Promise<void> {
  // 1. Auth user — create or update, mirroring the seed's upsert.
  let uid: string;
  try {
    const user = await auth.getUserByEmail(flags.email!);
    uid = user.uid;
    existed = true;
    console.log(`Auth user already exists (${uid}) — updating profile/claims only.`);
    await auth.updateUser(uid, {
      displayName: flags.name,
      emailVerified: true,
      disabled: false,
      ...(flags.password ? { password } : {}),
    });
  } catch {
    const user = await auth.createUser({
      email: flags.email,
      password,
      displayName: flags.name,
      emailVerified: true,
    });
    uid = user.uid;
    console.log(`Auth user created (${uid}).`);
  }

  // 2. Role claim — what lib/auth/session.ts verifies on every login.
  await auth.setCustomUserClaims(uid, { role: flags.role });

  // 3. users/{uid} doc — the app + rules' source of truth for role/scope.
  await db.collection("users").doc(uid).set(
    {
      uid,
      fullName: flags.name,
      email: flags.email,
      role: flags.role,
      propertyIds: flags.propertyIds,
      active: true,
      createdBy: "bootstrap:provision-staff",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 4. Audit trail — no change without one (docs/DECISIONS.md).
  await db.collection("auditLogs").add({
    actorUid: "bootstrap:provision-staff",
    actorRole: "admin",
    action: "staff.provisioned",
    entityType: "staff",
    entityId: uid,
    after: {
      email: flags.email,
      fullName: flags.name,
      role: flags.role,
      propertyIds: flags.propertyIds,
      active: true,
      source: existed ? "updated" : "created",
    },
    reason: "CLI staff provisioning (scripts/provision-staff.ts)",
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log("\nDone. Credentials (keep safe, printed only here):");
  console.table([{ email: flags.email, password, role: flags.role }]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Provisioning failed:", error);
    process.exit(1);
  });
