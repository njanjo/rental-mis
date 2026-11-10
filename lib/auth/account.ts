import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getAccount, listAccounts } from "@/lib/accounts";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/types";

/**
 * Account resolution for the single-operator deployment.
 *
 * The multi-tenant model requires every profile to carry an `accountId`, but a
 * deployment run by one person should never have to type or remember one. When
 * a profile is missing its account we fall back to `BOMA_DEFAULT_ACCOUNT_ID`,
 * or the only active account, and repair the profile once at sign-in.
 */

/** The account a new/legacy profile should join, or null when ambiguous. */
export async function resolveDefaultAccountId(): Promise<string | null> {
  const configured = process.env.BOMA_DEFAULT_ACCOUNT_ID?.trim();
  if (configured) {
    const account = await getAccount(configured);
    if (account && account.status === "active") return account.id;
  }

  const accounts = await listAccounts("active");
  if (accounts.length === 1) return accounts[0].id;
  return null;
}

export interface EnsureAccountResult {
  accountId: string | null;
  /** True when the profile was missing `accountId` and has just been repaired. */
  repaired: boolean;
}

/**
 * Guarantee a staff profile has an account. A profile that already carries one
 * is returned untouched; a legacy profile without one is pointed at the default
 * account and audited, so access can never change silently.
 */
export async function ensureProfileAccount(
  uid: string,
  accountId: string | null | undefined,
  context: { email?: string; role?: Role } = {},
): Promise<EnsureAccountResult> {
  if (accountId) return { accountId, repaired: false };

  const fallback = await resolveDefaultAccountId();
  if (!fallback) return { accountId: null, repaired: false };

  const now = FieldValue.serverTimestamp();
  await adminDb()
    .collection("users")
    .doc(uid)
    .set({ accountId: fallback, updatedAt: now }, { merge: true });

  await adminDb()
    .collection("auditLogs")
    .add({
      accountId: fallback,
      actorUid: "system:session",
      actorRole: "admin",
      action: "staff.account_repaired",
      entityType: "staff",
      entityId: uid,
      after: {
        accountId: fallback,
        ...(context.email ? { email: context.email } : {}),
        ...(context.role ? { role: context.role } : {}),
      },
      reason:
        "Profile had no accountId; resolved to the default account at sign-in.",
      createdAt: now,
    });

  return { accountId: fallback, repaired: true };
}
