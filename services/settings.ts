import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getSystemSettings, SETTINGS_COLLECTION } from "@/lib/accounts";
import { writeAuditLog } from "@/lib/audit";
import { assertCapability, requireAccount } from "@/lib/auth/scope";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_SMS_TEMPLATES,
} from "@/lib/sms";
import type {
  BillingRules,
  ReminderRules,
  SmsTemplate,
} from "@/lib/types";
import type { AccountSettings } from "@/lib/accounts";
import type {
  BillingRulesInput,
  ReminderRulesInput,
  SmsTemplateInput,
} from "@/lib/validation/settings";

/**
 * Account settings (docs/DECISIONS.md, Decision F): one
 * `systemSettings/{accountId}` document per account with `billing`,
 * `reminders` and `templates` sections. Clients can never write settings
 * (rules deny it); these server actions are the only edit path and every
 * change lands with an audit entry in the same transaction.
 */

// Safe defaults mirror the behaviour that shipped before the settings page
// existed (docs/DECISIONS.md #11, #12, #13 and the Phase 6 reminder cadence).
export const DEFAULT_BILLING: BillingRules = {
  allocationStrategy: "oldest_first",
  overpayment: "tenant_credit",
  lateFeeEnabled: false,
  lateFeeMinor: 0,
  gracePeriodDays: 7,
  invoiceGenerationDay: 1,
};

export const DEFAULT_REMINDERS: ReminderRules = {
  dueSoonDaysBefore: 3,
  overdueRepeatDays: 7,
  maxAttempts: 5,
};

/** The live templates only — lease_expiry / bulk_announcement have no flow yet. */
function defaultTemplates(): SmsTemplate[] {
  return (Object.keys(DEFAULT_SMS_TEMPLATES) as Array<
    keyof typeof DEFAULT_SMS_TEMPLATES
  >).map((key) => ({
    key,
    body: DEFAULT_SMS_TEMPLATES[key],
    enabled: true,
  }));
}

export interface SettingsView {
  timezone: string;
  currency: string;
  billing: BillingRules;
  reminders: ReminderRules;
  templates: SmsTemplate[];
}

export async function readSettings(
  actor: SessionUser,
): Promise<SettingsView> {
  assertCapability(actor, "manage_settings");
  const accountId = requireAccount(actor);
  const settings: AccountSettings = await getSystemSettings(accountId);

  return {
    timezone: settings.timezone,
    currency: settings.currency,
    billing: { ...DEFAULT_BILLING, ...(settings.billing ?? {}) },
    reminders: { ...DEFAULT_REMINDERS, ...(settings.reminders ?? {}) },
    // Stored entries replace defaults per key; disabled rows keep their body.
    templates: defaultTemplates().map((fallback) => {
      const stored = (settings.templates ?? []).find(
        (template) => template.key === fallback.key,
      );
      return stored ?? fallback;
    }),
  };
}

/** Validated settings document reference, always the actor's own account. */
function settingsRef(accountId: string) {
  return adminDb().collection(SETTINGS_COLLECTION).doc(accountId);
}

type SettingsSection = "billing" | "reminders" | "templates";

function updateSection(
  actor: SessionUser,
  section: SettingsSection,
  action: string,
  after: unknown,
): Promise<void> {
  assertCapability(actor, "manage_settings");
  const accountId = requireAccount(actor);
  const db = adminDb();
  const ref = settingsRef(accountId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const before = snapshot.exists
      ? (snapshot.data() as Record<string, unknown>)[section]
      : undefined;

    tx.set(
      ref,
      {
        [section]: after,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      },
      { merge: true },
    );

    writeAuditLog(tx, {
      accountId,
      actorUid: actor.uid,
      actorRole: actor.role,
      action,
      entityType: "settings",
      entityId: accountId,
      before: { [section]: before ?? null },
      after: { [section]: after },
    });
  });
}

function billingFromInput(input: BillingRulesInput): BillingRules {
  return {
    allocationStrategy: input.allocationStrategy,
    overpayment: input.overpayment,
    lateFeeEnabled: input.lateFeeEnabled,
    lateFeeMinor: input.lateFeeAmount,
    gracePeriodDays: input.gracePeriodDays,
    invoiceGenerationDay: input.invoiceGenerationDay,
  };
}

export async function updateBillingRules(
  actor: SessionUser,
  input: BillingRulesInput,
): Promise<void> {
  return updateSection(
    actor,
    "billing",
    "settings.billing_updated",
    billingFromInput(input),
  );
}

export async function updateReminderRules(
  actor: SessionUser,
  input: ReminderRulesInput,
): Promise<void> {
  return updateSection(actor, "reminders", "settings.reminders_updated", {
    ...input,
    maxAttempts: DEFAULT_REMINDERS.maxAttempts,
  });
}

export async function updateSmsTemplates(
  actor: SessionUser,
  templates: SmsTemplateInput[],
): Promise<void> {
  return updateSection(actor, "templates", "settings.templates_updated", templates);
}
