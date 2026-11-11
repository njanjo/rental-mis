import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { DEFAULT_SMS_TEMPLATES } from "@/lib/sms";
import type { Role } from "@/lib/types";
import type {
  BillingRulesInput,
  SmsTemplateInput,
} from "@/lib/validation/settings";
import {
  readSettings,
  updateBillingRules,
  updateReminderRules,
  updateSmsTemplates,
} from "@/services/settings";

const db = () => adminDb();
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
const finance = actor("finance");

function billingInput(
  overrides: Partial<BillingRulesInput> = {},
): BillingRulesInput {
  return {
    allocationStrategy: "newest_first",
    overpayment: "review",
    lateFeeEnabled: true,
    lateFeeAmount: 250_000,
    gracePeriodDays: 14,
    invoiceGenerationDay: 15,
    ...overrides,
  };
}

/** What updateBillingRules persists for `billingInput()` (minor units). */
const STORED_BILLING = {
  allocationStrategy: "newest_first",
  overpayment: "review",
  lateFeeEnabled: true,
  lateFeeMinor: 250_000,
  gracePeriodDays: 14,
  invoiceGenerationDay: 15,
} as const;

function templatesInput(): SmsTemplateInput[] {
  return [
    {
      key: "payment_receipt",
      body: "Receipt {{reference}}: {{amount}} received on {{date}}. Thank you.",
      enabled: true,
    },
    {
      key: "rent_due_reminder",
      body: "Hello {{name}}, rent of {{amount}} is due on {{dueDate}}.",
      enabled: true,
    },
    {
      key: "arrears_notice",
      body: "Hello {{name}}, your balance of {{amount}} is overdue.",
      enabled: false,
    },
  ];
}

async function auditLogs(action: string) {
  return db().collection("auditLogs").where("action", "==", action).get();
}

async function storedSettings() {
  return (await db().collection("systemSettings").doc(ACCOUNT).get()).data();
}

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    ["systemSettings", "auditLogs"].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );
});

describe("readSettings", () => {
  it("returns the safe defaults when no settings document exists", async () => {
    const view = await readSettings(admin);

    expect(view.timezone).toBe("Africa/Nairobi");
    expect(view.currency).toBe("KES");
    expect(view.billing).toEqual({
      allocationStrategy: "oldest_first",
      overpayment: "tenant_credit",
      lateFeeEnabled: false,
      lateFeeMinor: 0,
      gracePeriodDays: 7,
      invoiceGenerationDay: 1,
    });
    expect(view.reminders).toEqual({
      dueSoonDaysBefore: 3,
      overdueRepeatDays: 7,
      maxAttempts: 5,
    });
    expect(view.templates.map((template) => template.key)).toEqual([
      "payment_receipt",
      "rent_due_reminder",
      "arrears_notice",
    ]);
    expect(view.templates.every((template) => template.enabled)).toBe(true);
    expect(view.templates[0].body).toBe(DEFAULT_SMS_TEMPLATES.payment_receipt);
  });

  it("merges stored sections over the defaults", async () => {
    await db()
      .collection("systemSettings")
      .doc(ACCOUNT)
      .set({
        timezone: "Africa/Nairobi",
        currency: "KES",
        billing: { allocationStrategy: "newest_first" },
        reminders: { overdueRepeatDays: 10 },
        templates: [
          { key: "payment_receipt", body: "Custom receipt wording.", enabled: false },
        ],
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "uid_admin",
      });

    const view = await readSettings(admin);

    expect(view.billing).toEqual({
      allocationStrategy: "newest_first",
      overpayment: "tenant_credit",
      lateFeeEnabled: false,
      lateFeeMinor: 0,
      gracePeriodDays: 7,
      invoiceGenerationDay: 1,
    });
    expect(view.reminders).toEqual({
      dueSoonDaysBefore: 3,
      overdueRepeatDays: 10,
      maxAttempts: 5,
    });

    const receipt = view.templates.find(
      (template) => template.key === "payment_receipt",
    );
    expect(receipt).toMatchObject({
      body: "Custom receipt wording.",
      enabled: false,
    });

    const reminder = view.templates.find(
      (template) => template.key === "rent_due_reminder",
    );
    expect(reminder).toMatchObject({
      body: DEFAULT_SMS_TEMPLATES.rent_due_reminder,
      enabled: true,
    });
  });
});

describe("updateBillingRules", () => {
  it("writes the section, stamps the actor and audits before/after", async () => {
    await updateBillingRules(admin, billingInput());

    const stored = await storedSettings();
    expect(stored?.billing).toEqual(STORED_BILLING);
    expect(stored?.updatedBy).toBe(admin.uid);
    expect(stored?.updatedAt).toBeTruthy();

    const logs = await auditLogs("settings.billing_updated");
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({
      accountId: ACCOUNT,
      actorUid: admin.uid,
      actorRole: "admin",
      entityType: "settings",
      entityId: ACCOUNT,
    });
    expect(logs.docs[0].data().before).toEqual({ billing: null });
    expect(logs.docs[0].data().after).toEqual({ billing: STORED_BILLING });
  });

  it("carries the previous section into before on a second update", async () => {
    await updateBillingRules(admin, billingInput());
    await updateBillingRules(
      admin,
      billingInput({
        allocationStrategy: "oldest_first",
        overpayment: "tenant_credit",
        lateFeeEnabled: false,
        lateFeeAmount: 0,
        gracePeriodDays: 3,
        invoiceGenerationDay: 5,
      }),
    );

    const stored = await storedSettings();
    expect(stored?.billing).toMatchObject({
      allocationStrategy: "oldest_first",
      lateFeeEnabled: false,
      lateFeeMinor: 0,
    });

    const logs = await auditLogs("settings.billing_updated");
    expect(logs.size).toBe(2);
    const second = logs.docs.find(
      (doc) => (doc.data().before?.billing ?? null) !== null,
    );
    expect(second?.data().before?.billing).toEqual(STORED_BILLING);
    expect(second?.data().after?.billing).toMatchObject({
      allocationStrategy: "oldest_first",
      lateFeeMinor: 0,
    });
  });
});

describe("updateReminderRules", () => {
  it("writes the reminders section and audits the change", async () => {
    await updateReminderRules(admin, {
      dueSoonDaysBefore: 5,
      overdueRepeatDays: 14,
    });

    const stored = await storedSettings();
    expect(stored?.reminders).toEqual({
      dueSoonDaysBefore: 5,
      overdueRepeatDays: 14,
      maxAttempts: 5,
    });
    expect(stored?.updatedBy).toBe(admin.uid);

    const logs = await auditLogs("settings.reminders_updated");
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({
      entityType: "settings",
      entityId: ACCOUNT,
    });
    expect(logs.docs[0].data().before).toEqual({ reminders: null });
    expect(logs.docs[0].data().after).toEqual({
      reminders: { dueSoonDaysBefore: 5, overdueRepeatDays: 14, maxAttempts: 5 },
    });
  });
});

describe("updateSmsTemplates", () => {
  it("stores the template array and audits the change", async () => {
    await updateSmsTemplates(admin, templatesInput());

    const stored = await storedSettings();
    expect(stored?.templates).toEqual(templatesInput());
    expect(stored?.updatedBy).toBe(admin.uid);

    const logs = await auditLogs("settings.templates_updated");
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({
      entityType: "settings",
      entityId: ACCOUNT,
    });
    expect(logs.docs[0].data().before).toEqual({ templates: null });
    expect(logs.docs[0].data().after).toEqual({
      templates: templatesInput(),
    });
  });
});

describe("settings authorisation", () => {
  it("refuses every update from a finance actor", async () => {
    await expect(
      updateBillingRules(finance, billingInput()),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      updateBillingRules(finance, billingInput()),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateReminderRules(finance, {
        dueSoonDaysBefore: 5,
        overdueRepeatDays: 14,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateSmsTemplates(finance, templatesInput()),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Nothing was written and nothing was audited.
    expect((await db().collection("systemSettings").get()).empty).toBe(true);
    expect((await db().collection("auditLogs").get()).empty).toBe(true);
  });
});
