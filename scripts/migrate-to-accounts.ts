/**
 * Phase 1 backfill: attach every existing document to a customer account.
 *
 * Decision A (docs/DECISIONS.md): collections stay flat; every document gains
 * an `accountId` field. This script is the only place that writes that field
 * across a whole database, and it is safe to re-run:
 *
 *   - documents that already carry the target id are counted, not rewritten;
 *   - documents carrying a *different* account id are reported and left alone;
 *   - `tenantPhones` ids move from `<phone>` to `<accountId>_<phone>`;
 *   - legacy `systemSettings/{billing|reminders|sms}` sections are copied into
 *     `systemSettings/{accountId}` without deleting the originals, so a code
 *     rollback still finds its settings;
 *   - the account doc is only marked `legacyMigrated: true` after a clean pass.
 *
 * Runbook order (boma-phase1-multitenant-implementation.md): run this BEFORE
 * deploying the account-scoped app and rules. Old code ignores the new fields,
 * so a backfilled database keeps working during the deploy window.
 *
 * Usage:
 *
 *   # 1. rehearsal against the local emulator (no confirm needed for dry-run)
 *   npx tsx scripts/migrate-to-accounts.ts \
 *     --project demo-rental-mis --account acc_demo --dry-run
 *
 *   # 2. real run (pass --confirm to write)
 *   npx tsx scripts/migrate-to-accounts.ts \
 *     --project rental-mis-prod --confirm \
 *     --account acc_rentals_first --name "Rentals First Ltd" --customer-type agency
 *
 * Credentials reuse the app chain: FIREBASE_SERVICE_ACCOUNT (whole JSON) ->
 * FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY -> ADC (emulator runs).
 */
import { getApp, getApps, initializeApp, cert, type AppOptions } from "firebase-admin/app";
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type CustomerType = "agency" | "landlord";

type Flags = {
  project?: string;
  confirm: boolean;
  dryRun: boolean;
  account?: string;
  name?: string;
  customerType: CustomerType;
  envFile?: string;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    confirm: false,
    dryRun: false,
    customerType: "agency",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const hasValue = index + 1 < argv.length && !argv[index + 1].startsWith("--");
    const value = hasValue ? argv[index + 1] : undefined;
    if (hasValue) index += 1;

    switch (key) {
      case "--project": flags.project = value; break;
      case "--confirm": flags.confirm = true; break;
      case "--dry-run": flags.dryRun = true; break;
      case "--account": flags.account = value; break;
      case "--name": flags.name = value; break;
      case "--customer-type": flags.customerType = (value ?? "agency") as CustomerType; break;
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
  "  npx tsx scripts/migrate-to-accounts.ts --project <project-id> --account <accountId> \\\n" +
  "    [--name \"Customer Name\"] [--customer-type agency|landlord] [--dry-run] [--confirm] [--env-file <file>]\n" +
  "\n  --dry-run reports what would change and writes nothing.\n" +
  "  Writes require --confirm (production safety).\n";

// ---------------------------------------------------------------------------
// Environment (mirrors scripts/provision-staff.ts)
// ---------------------------------------------------------------------------

const flags = parseFlags(process.argv.slice(2));

if (flags.envFile) {
  try {
    process.loadEnvFile?.(flags.envFile);
  } catch {
    fail(`Could not load env file: ${flags.envFile}`);
  }
} else {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {
    // Optional.
  }
}

if (flags.envFile) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const projectId = flags.project ?? process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  fail("No project id: pass --project <id> (or set FIREBASE_PROJECT_ID).");
}
if (!flags.account) {
  fail("--account <accountId> is required; every document is attributed to it.");
}
if (!["agency", "landlord"].includes(flags.customerType)) {
  fail("--customer-type must be agency or landlord.");
}
if (!flags.dryRun && !flags.confirm) {
  fail(
    `Refusing to write to project "${projectId}" without --confirm. ` +
      "Run with --dry-run first to review the changes.",
  );
}
if (process.env.CI) {
  fail("CI detected. Backfilling is a local runbook command.");
}

const isDemoProject = projectId.startsWith("demo-");
if (!isDemoProject && (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  fail(
    "Emulator hosts are set (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST) " +
      `but the target project "${projectId}" is not a demo-* id. Unset them for production.`,
  );
}
if (isDemoProject) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

// ---------------------------------------------------------------------------
// Credentials
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

  return { projectId };
}

const app = getApps().length > 0 ? getApp() : initializeApp(buildAppOptions());
const db: Firestore = getFirestore(app);

const ACCOUNT_ID = flags.account;
const ACCOUNT_NAME = (flags.name ?? "Default Account").trim();
const PAGE_SIZE = 400;

/** Collections that hold account-scoped data. `accounts` is the root itself. */
const DATA_COLLECTIONS = [
  "users",
  "properties",
  "units",
  "tenants",
  "leases",
  "invoices",
  "payments",
  "paymentAllocations",
  "unmatchedPayments",
  "providerEvents",
  "smsOutbox",
  "smsLogs",
  "maintenanceRequests",
  "auditLogs",
  "bankSyncRuns",
] as const;

interface CollectionResult {
  collection: string;
  scanned: number;
  patched: number;
  already: number;
  foreign: number;
}

async function backfillCollection(collection: string): Promise<CollectionResult> {
  const result: CollectionResult = {
    collection,
    scanned: 0,
    patched: 0,
    already: 0,
    foreign: 0,
  };

  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let pendingWrites = 0;

    for (const doc of snapshot.docs) {
      result.scanned += 1;
      const data = doc.data();

      if (data.accountId === ACCOUNT_ID) {
        result.already += 1;
        continue;
      }
      if (typeof data.accountId === "string" && data.accountId.length > 0) {
        result.foreign += 1;
        console.warn(
          `  ! ${collection}/${doc.id} already belongs to "${data.accountId}" — left untouched.`,
        );
        continue;
      }

      result.patched += 1;
      if (!flags.dryRun) {
        batch.update(doc.ref, {
          accountId: ACCOUNT_ID,
          updatedAt: FieldValue.serverTimestamp(),
        });
        pendingWrites += 1;
      }
    }

    if (!flags.dryRun && pendingWrites > 0) await batch.commit();

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return result;
}

interface TenantPhoneResult {
  scanned: number;
  rewritten: number;
  already: number;
  conflicts: number;
}

/** Decision E: tenantPhones doc id is `{accountId}_{phone}`. */
async function rewriteTenantPhones(): Promise<TenantPhoneResult> {
  const result: TenantPhoneResult = {
    scanned: 0,
    rewritten: 0,
    already: 0,
    conflicts: 0,
  };

  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db
      .collection("tenantPhones")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let pendingWrites = 0;

    for (const doc of snapshot.docs) {
      result.scanned += 1;
      const data = doc.data();
      const phone = String(data.phoneE164 ?? doc.id);
      const targetId = `${ACCOUNT_ID}_${phone}`;

      if (doc.id === targetId) {
        result.already += 1;
        continue;
      }
      if (doc.id.startsWith(`${ACCOUNT_ID}_`)) {
        result.already += 1;
        continue;
      }

      const targetRef = db.collection("tenantPhones").doc(targetId);
      const targetSnapshot = flags.dryRun ? null : await targetRef.get();
      if (targetSnapshot?.exists) {
        result.conflicts += 1;
        // The target is authoritative; remove the legacy duplicate.
        if (!flags.dryRun) {
          batch.delete(doc.ref);
          pendingWrites += 1;
        }
        continue;
      }

      result.rewritten += 1;
      if (!flags.dryRun) {
        batch.set(targetRef, {
          ...data,
          accountId: ACCOUNT_ID,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.delete(doc.ref);
        pendingWrites += 2;
      }
    }

    if (!flags.dryRun && pendingWrites > 0) await batch.commit();

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return result;
}

interface SettingsResult {
  merged: boolean;
  sections: string[];
}

/** Decision F: fold legacy `billing`/`reminders`/`sms` docs into one doc. */
async function mergeSettings(): Promise<SettingsResult> {
  const legacyIds = ["billing", "reminders", "sms"] as const;
  const merged: Record<string, unknown> = {};
  const sections: string[] = [];

  for (const id of legacyIds) {
    const snapshot = await db.collection("systemSettings").doc(id).get();
    if (!snapshot.exists) continue;
    const data = snapshot.data() ?? {};
    for (const section of ["billing", "reminders", "templates"] as const) {
      if (data[section] !== undefined && merged[section] === undefined) {
        merged[section] = data[section];
      }
    }
    if (data.timezone && merged.timezone === undefined) merged.timezone = data.timezone;
    if (data.currency && merged.currency === undefined) merged.currency = data.currency;
    sections.push(id);
  }

  if (sections.length === 0) return { merged: false, sections };

  const targetRef = db.collection("systemSettings").doc(ACCOUNT_ID);
  const targetSnapshot = await targetRef.get();
  const existing = targetSnapshot.data() ?? {};

  // Do not overwrite sections an operator already set on the account doc.
  const patch: Record<string, unknown> = {
    accountId: ACCOUNT_ID,
    timezone: existing.timezone ?? merged.timezone ?? "Africa/Nairobi",
    currency: existing.currency ?? merged.currency ?? "KES",
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const section of ["billing", "reminders", "templates"] as const) {
    if (existing[section] === undefined && merged[section] !== undefined) {
      patch[section] = merged[section];
    }
  }

  if (!flags.dryRun) await targetRef.set(patch, { merge: true });
  return { merged: true, sections };
}

interface VerificationResult {
  collection: string;
  total: number;
  unattributed: number;
}

/** Post-backfill scan: zero documents may lack the target account id. */
async function verifyCollection(collection: string): Promise<VerificationResult> {
  const result: VerificationResult = { collection, total: 0, unattributed: 0 };

  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      result.total += 1;
      if (doc.data().accountId !== ACCOUNT_ID) result.unattributed += 1;
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return result;
}

async function main(): Promise<void> {
  console.log(
    `\n${flags.dryRun ? "DRY RUN — nothing will be written" : "MIGRATING"} ` +
      `project "${projectId}" into account "${ACCOUNT_ID}" (${ACCOUNT_NAME}).\n`,
  );

  // 1. Ensure the account root exists. The marker stays false until a clean pass.
  const accountRef = db.collection("accounts").doc(ACCOUNT_ID);
  const existingAccount = await accountRef.get();
  if (!flags.dryRun) {
    await accountRef.set(
      {
        id: ACCOUNT_ID,
        name: ACCOUNT_NAME,
        nameLower: ACCOUNT_NAME.toLowerCase(),
        customerType: flags.customerType,
        status: existingAccount.data()?.status ?? "active",
        contactPhoneE164: existingAccount.data()?.contactPhoneE164,
        contactEmail: existingAccount.data()?.contactEmail,
        legacyMigrated: false,
        createdAt: existingAccount.data()?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  // 2. Backfill accountId on every data collection (idempotent).
  const results: CollectionResult[] = [];
  for (const collection of DATA_COLLECTIONS) {
    const result = await backfillCollection(collection);
    results.push(result);
    console.log(
      `  ${collection.padEnd(22)} scanned ${String(result.scanned).padStart(6)} ` +
        `patched ${String(result.patched).padStart(6)} ` +
        `already ${String(result.already).padStart(6)} ` +
        (result.foreign ? `foreign ${result.foreign}` : ""),
    );
  }

  // 3. Decision E: rewrite the phone index ids.
  const phoneResult = await rewriteTenantPhones();
  console.log(
    `  ${"tenantPhones".padEnd(22)} scanned ${String(phoneResult.scanned).padStart(6)} ` +
      `rewritten ${String(phoneResult.rewritten).padStart(6)} ` +
      `already ${String(phoneResult.already).padStart(6)} ` +
      (phoneResult.conflicts ? `conflicts ${phoneResult.conflicts}` : ""),
  );

  // 4. Decision F: merge legacy settings sections into the account doc.
  const settingsResult = await mergeSettings();
  console.log(
    `  ${"systemSettings".padEnd(22)} ${settingsResult.merged
      ? `merged from: ${settingsResult.sections.join(", ")}`
      : "no legacy settings found"}`,
  );

  // 5. Verification pass.
  const verification: VerificationResult[] = [];
  for (const collection of DATA_COLLECTIONS) {
    verification.push(await verifyCollection(collection));
  }
  const unattributed = verification.reduce(
    (total, row) => total + row.unattributed,
    0,
  );

  console.table([
    ...results.map((row) => ({
      collection: row.collection,
      scanned: row.scanned,
      patched: flags.dryRun ? `would patch ${row.patched}` : row.patched,
      already: row.already,
      foreign: row.foreign,
    })),
    {
      collection: "tenantPhones",
      scanned: phoneResult.scanned,
      patched: flags.dryRun
        ? `would rewrite ${phoneResult.rewritten}`
        : phoneResult.rewritten,
      already: phoneResult.already,
      foreign: phoneResult.conflicts,
    },
  ]);

  if (flags.dryRun) {
    if (unattributed > 0) {
      console.log(
        `\nℹ Dry run: ${unattributed} document(s) would gain accountId "${ACCOUNT_ID}" on apply.`,
      );
    }
    console.log("Dry run complete. Re-run with --confirm to apply.\n");
    return;
  }

  if (unattributed > 0) {
    console.error(
      `\n✗ Verification failed: ${unattributed} document(s) still lack accountId "${ACCOUNT_ID}".`,
    );
    console.error("  Resolve the foreign/conflicting rows above and re-run.");
    process.exit(1);
  }
  console.log(`\n✓ Verification passed: every data document belongs to "${ACCOUNT_ID}".`);

  // 6. Mark the account migrated and record the audit trail.
  await accountRef.set(
    { legacyMigrated: true, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("auditLogs").add({
    accountId: ACCOUNT_ID,
    actorUid: "bootstrap:migrate-to-accounts",
    actorRole: "admin",
    action: "account.migrated",
    entityType: "account",
    entityId: ACCOUNT_ID,
    after: {
      collections: results,
      tenantPhones: phoneResult,
      settings: settingsResult,
      migration: "phase1-flat-accountId",
    },
    reason: "CLI Phase 1 backfill (scripts/migrate-to-accounts.ts)",
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`✓ account "${ACCOUNT_ID}" marked legacyMigrated.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
