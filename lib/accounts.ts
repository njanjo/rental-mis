import "server-only";

import { Timestamp, type Query } from "firebase-admin/firestore";

import type { Account, AccountType, BillingRules, ReminderRules, SmsTemplate } from "@/lib/types";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Account helpers for the multi-tenant model.
 *
 * Accounts are the customer root. Documents carry `accountId`, never nest
 * under `accounts/{id}` (decision A — flat collections, see
 * docs/DECISIONS.md and the Phase 1 plan).
 */

export const ACCOUNTS_COLLECTION = "accounts";
export const SETTINGS_COLLECTION = "systemSettings";

/** Configuration error raised when no default account has been provisioned. */
export class MissingAccountError extends ServiceError {
  constructor(message = "No account context available.") {
    super("internal", message);
  }
}

/** The account M-Pesa callbacks and unattended jobs land in (Decision D). */
export function defaultAccountId(): string {
  const id = process.env.BOMA_DEFAULT_ACCOUNT_ID;
  if (!id) {
    throw new MissingAccountError(
      "BOMA_DEFAULT_ACCOUNT_ID is not configured. Provision an account and set the env var before ingestion can route payments.",
    );
  }
  return id;
}

/** Resolve a callback/worker account to a persisted Account, or null if none. */
export async function defaultAccount(): Promise<Account | null> {
  try {
    const id = defaultAccountId();
    return await getAccount(id);
  } catch {
    return null;
  }
}

export async function getAccount(accountId: string): Promise<Account | null> {
  if (!accountId) return null;
  const snapshot = await adminDb()
    .collection(ACCOUNTS_COLLECTION)
    .doc(accountId)
    .get();
  if (!snapshot.exists) return null;
  return { ...(snapshot.data() as Account), id: snapshot.id };
}

/** All accounts in the system; used by unattended jobs that run per account. */
export async function listAccounts(
  status?: Account["status"],
): Promise<Account[]> {
  let query: Query = adminDb().collection(ACCOUNTS_COLLECTION);
  if (status) {
    query = query.where("status", "==", status);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as Account), id: doc.id }));
}

export interface CreateAccountInput {
  id?: string;
  name: string;
  customerType: AccountType;
  contactPhoneE164?: string;
  contactEmail?: string;
}

/**
 * Create or fetch an account. Called by provisioning scripts and the seed;
 * service code does not create accounts (Phase 2 adds the guided flow).
 */
export async function createAccount(
  input: CreateAccountInput,
): Promise<Account> {
  const name = input.name.trim();
  if (!name) {
    throw new ServiceError("validation", "An account name is required.");
  }
  const now = Timestamp.now();
  const docRef = input.id
    ? adminDb().collection(ACCOUNTS_COLLECTION).doc(input.id)
    : adminDb().collection(ACCOUNTS_COLLECTION).doc();

  const existing = await docRef.get();
  // The admin Timestamp satisfies Firestore at runtime; the type-only
  // mismatch comes from lib/types being authored against the client SDK.
  const account = {
    id: docRef.id,
    name,
    nameLower: name.toLowerCase(),
    customerType: input.customerType,
    status: existing.exists ? (existing.data()?.status ?? "active") : "active",
    contactPhoneE164: input.contactPhoneE164,
    contactEmail: input.contactEmail,
    createdAt: existing.exists ? existing.data()?.createdAt : now,
    updatedAt: now,
  } as unknown as Account;

  await docRef.set(account, { merge: true });
  return account;
}

/**
 * Account settings document (Decision F): one `systemSettings/{accountId}`
 * doc per account, sections inside. Missing docs resolve to safe defaults.
 */
export async function getSystemSettings(
  accountId: string,
): Promise<AccountSettings> {
  if (!accountId) {
    throw new MissingAccountError("An account id is required.");
  }
  const snapshot = await adminDb()
    .collection(SETTINGS_COLLECTION)
    .doc(accountId)
    .get();
  if (!snapshot.exists) {
    return { ...EMPTY_SETTINGS };
  }
  return snapshot.data() as AccountSettings;
}

export interface AccountSettings {
  timezone: string;
  currency: string;
  billing?: BillingRules;
  reminders?: ReminderRules;
  templates?: SmsTemplate[];
}

export const EMPTY_SETTINGS: AccountSettings = {
  timezone: "Africa/Nairobi",
  currency: "KES",
};
