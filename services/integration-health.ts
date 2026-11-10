import "server-only";

import {
  assertCapability,
  requireAccount,
} from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { defaultAccount } from "@/lib/accounts";
import { adminDb } from "@/lib/firebase/admin";
import { toIsoString } from "@/lib/dates";

/**
 * Integration health for the settings page.
 *
 * Two layers of signal:
 * - Configuration presence: which env vars a provider needs to work, checked
 *   without ever echoing a secret value.
 * - Live signals: bounded counts from the operation collections (failed provider
 *   callbacks, dead-letter SMS, the most recent bank import run).
 */

export type CheckStatus = "ok" | "missing";

export interface ConfigCheck {
  name: string;
  /** What the check looks at, e.g. "MPESA_CONSUMER_KEY". Safe to render. */
  detail: string;
  status: CheckStatus;
}

export interface IntegrationSignals {
  /** Failed provider callbacks among the last 30 events ("50+" when capped). */
  failedProviderEvents: number;
  providerEventsTruncated: boolean;
  smsDeadLetter: number;
  smsFailed: number;
  unmatchedOpenCount: number;
  lastBankSync?: {
    id: string;
    bankCode: string;
    status: string;
    startedAt: string;
    fileName?: string;
  };
}

export interface IntegrationHealthReport {
  /** "local" when emulator hosts are set, otherwise the deployment runtime. */
  runtime: "emulator" | "production";
  mpesa: {
    configured: boolean;
    /** "sandbox" | "production" | "unknown" as configured. */
    environment: string;
    checks: ConfigCheck[];
  };
  beam: {
    configured: boolean;
    checks: ConfigCheck[];
  };
  firebase: {
    configured: boolean;
    checks: ConfigCheck[];
  };
  routing: {
    configured: boolean;
    checks: ConfigCheck[];
  };
  signals: IntegrationSignals;
}

function check(name: string, detail: string, present: boolean): ConfigCheck {
  return { name, detail, status: present ? "ok" : "missing" };
}

function allPresent(checks: ConfigCheck[]): boolean {
  return checks.every((entry) => entry.status === "ok");
}

export async function integrationHealth(
  actor: SessionUser,
): Promise<IntegrationHealthReport> {
  assertCapability(actor, "manage_settings");
  requireAccount(actor);

  const env = process.env;
  const optional = (value: string | undefined) => Boolean(value?.trim());

  // -- Firebase admin credentials -------------------------------------------
  let serviceAccountValid = false;
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as {
        client_email?: string;
        private_key?: string;
      };
      serviceAccountValid = Boolean(parsed.client_email && parsed.private_key);
    } catch {
      serviceAccountValid = false;
    }
  }
  const firebaseChecks: ConfigCheck[] = [
    check(
      "Service account",
      "FIREBASE_SERVICE_ACCOUNT (whole JSON) or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY",
      serviceAccountValid ||
        (optional(env.FIREBASE_CLIENT_EMAIL) && optional(env.FIREBASE_PRIVATE_KEY)),
    ),
    check("Project id", "FIREBASE_PROJECT_ID", optional(env.FIREBASE_PROJECT_ID)),
  ];

  // -- M-Pesa (Daraja) -------------------------------------------------------
  const callbackSecretPresent = optional(env.MPESA_CALLBACK_SECRET);
  const mpesaEnvironment =
    env.MPESA_ENV?.trim().toLowerCase() ||
    (env.MPESA_CONSUMER_KEY ? "sandbox (assumed)" : "unknown");
  const mpesaChecks: ConfigCheck[] = [
    check("Consumer key", "MPESA_CONSUMER_KEY", optional(env.MPESA_CONSUMER_KEY)),
    check("Consumer secret", "MPESA_CONSUMER_SECRET", optional(env.MPESA_CONSUMER_SECRET)),
    check("Shortcode", "MPESA_SHORTCODE", optional(env.MPESA_SHORTCODE)),
    check("Passkey", "MPESA_PASSKEY", optional(env.MPESA_PASSKEY)),
    check(
      "Callback base URL",
      "MPESA_CALLBACK_BASE_URL",
      optional(env.MPESA_CALLBACK_BASE_URL),
    ),
    check(
      "Callback secret",
      "MPESA_CALLBACK_SECRET (random path segment, 16+ chars)",
      callbackSecretPresent && env.MPESA_CALLBACK_SECRET!.trim().length >= 16,
    ),
  ];

  // -- Beam SMS --------------------------------------------------------------
  const beamChecks: ConfigCheck[] = [
    check("API key", "BEAM_SMS_API_KEY", optional(env.BEAM_SMS_API_KEY)),
    check("Sender ID", "BEAM_SMS_SENDER_ID", optional(env.BEAM_SMS_SENDER_ID)),
  ];

  // -- Payment routing (Phase 1 default account) ------------------------------
  const resolvedAccount = await defaultAccount().catch(() => null);
  const routingChecks: ConfigCheck[] = [
    check(
      "Default account",
      "BOMA_DEFAULT_ACCOUNT_ID (routes M-Pesa callbacks and cron jobs)",
      Boolean(resolvedAccount),
    ),
    ...(resolvedAccount
      ? [check("Account exists", `accounts/${resolvedAccount.id} readable`, true)]
      : []),
  ];

  const signals = await collectSignals(actor.accountId);

  const isEmulator = Boolean(
    env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  return {
    runtime: isEmulator ? "emulator" : "production",
    mpesa: {
      configured: allPresent(mpesaChecks),
      environment: mpesaEnvironment,
      checks: mpesaChecks,
    },
    beam: { configured: allPresent(beamChecks), checks: beamChecks },
    firebase: { configured: allPresent(firebaseChecks), checks: firebaseChecks },
    routing: { configured: allPresent(routingChecks), checks: routingChecks },
    signals,
  };
}

// ---------------------------------------------------------------------------
// Live signals (bounded scans, no composite indexes)
// ---------------------------------------------------------------------------

const EVENT_SCAN = 30;

async function collectSignals(accountId: string): Promise<IntegrationSignals> {
  const db = adminDb();

  const [providerEvents, deadLetter, failed, unmatched, bankSync] =
    await Promise.all([
      db
        .collection("providerEvents")
        .where("accountId", "==", accountId)
        .orderBy("receivedAt", "desc")
        .limit(EVENT_SCAN)
        .get(),
      db
        .collection("smsOutbox")
        .where("accountId", "==", accountId)
        .where("status", "==", "dead_letter")
        .count()
        .get(),
      db
        .collection("smsOutbox")
        .where("accountId", "==", accountId)
        .where("status", "==", "failed")
        .count()
        .get(),
      db
        .collection("unmatchedPayments")
        .where("accountId", "==", accountId)
        .where("reviewStatus", "==", "pending")
        .count()
        .get(),
      db
        .collection("bankSyncRuns")
        .where("accountId", "==", accountId)
        .orderBy("startedAt", "desc")
        .limit(1)
        .get(),
    ]);

  const failedEvents = providerEvents.docs.filter(
    (doc) => doc.data().processingStatus === "failed",
  ).length;

  const lastBank = bankSync.docs[0];
  const data = lastBank?.data() as
    | { bankCode?: string; status?: string; startedAt?: unknown; fileName?: string }
    | undefined;

  return {
    failedProviderEvents: failedEvents,
    providerEventsTruncated: providerEvents.size === EVENT_SCAN,
    smsDeadLetter: deadLetter.data().count,
    smsFailed: failed.data().count,
    unmatchedOpenCount: unmatched.data().count,
    lastBankSync: lastBank
      ? {
          id: lastBank.id,
          bankCode: data?.bankCode ?? "",
          status: data?.status ?? "",
          startedAt: toIsoString(data?.startedAt) ?? "",
          fileName: data?.fileName,
        }
      : undefined,
  };
}
