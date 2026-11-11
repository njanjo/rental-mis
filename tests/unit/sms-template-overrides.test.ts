import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { ServiceError } from "@/lib/errors";
import {
  DEFAULT_SMS_TEMPLATES,
  defaultSmsVariables,
  renderSmsBody,
} from "@/lib/sms";
import type { SmsTemplate } from "@/lib/types";
import { buildOutboxDoc, type EnqueueSmsInput } from "@/services/sms";

/**
 * Pure template-resolution tests for `buildOutboxDoc`. The outbox payload is
 * built from plain values plus FieldValue sentinels, so no Firestore emulator
 * is needed — the reminder job's override wiring is covered by the
 * integration suite.
 */

const ACCOUNT = "acc_demo";

const FACTS = {
  tenantName: "Grace Wanjiru",
  reference: "lease_1_2026-11",
  dateInput: "2026-11-02",
  moneyMinor: 4_500_000,
  dueDate: "2026-11-05",
  balanceMinor: 0,
};

/** The body the shipping default produced before overrides existed. */
const defaultReminderBody = renderSmsBody(
  DEFAULT_SMS_TEMPLATES.rent_due_reminder,
  defaultSmsVariables("rent_due_reminder", FACTS),
);

function sampleInput(overrides: Partial<EnqueueSmsInput> = {}): EnqueueSmsInput {
  return {
    accountId: ACCOUNT,
    phoneE164: "+254712345678",
    templateKey: "rent_due_reminder",
    ...FACTS,
    requestedBy: "system:reminders",
    ...overrides,
  };
}

function template(
  key: SmsTemplate["key"],
  body: string,
  enabled = true,
): SmsTemplate {
  return { key, body, enabled };
}

describe("buildOutboxDoc template overrides", () => {
  it("uses the account's override body", () => {
    const overrideBody =
      "Hi {{name}}, rent {{amount}} is due {{dueDate}}. Pay via BomaPay.";

    const doc = buildOutboxDoc(
      sampleInput({
        templates: [template("rent_due_reminder", overrideBody)],
      }),
    );

    expect(doc.body).toBe(
      renderSmsBody(
        overrideBody,
        defaultSmsVariables("rent_due_reminder", FACTS),
      ),
    );
    // The shipping wording must not leak into an overridden message.
    expect(doc.body).not.toContain("Pay via M-Pesa");
  });

  it("falls back to the default when the account stores no override for the key", () => {
    const doc = buildOutboxDoc(
      sampleInput({
        templates: [template("payment_receipt", "Receipt {{reference}}.")],
      }),
    );

    expect(doc.body).toBe(defaultReminderBody);
  });

  it("treats an empty override list as no overrides", () => {
    const doc = buildOutboxDoc(sampleInput({ templates: [] }));
    expect(doc.body).toBe(defaultReminderBody);
  });

  it("refuses to queue a disabled template", () => {
    let thrown: unknown;
    try {
      buildOutboxDoc(
        sampleInput({
          templates: [template("rent_due_reminder", "Hi {{name}}.", false)],
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceError);
    expect(thrown).toMatchObject({
      code: "validation",
      message: "That SMS template is not available yet.",
    });
  });

  it("keeps the shipping output when no templates are passed", () => {
    const doc = buildOutboxDoc(sampleInput());

    expect(doc).toEqual({
      accountId: ACCOUNT,
      phoneE164: "+254712345678",
      templateKey: "rent_due_reminder",
      variables: defaultSmsVariables("rent_due_reminder", FACTS),
      body: defaultReminderBody,
      status: "queued",
      attempts: 0,
      nextAttemptAt: FieldValue.serverTimestamp(),
      requestedBy: "system:reminders",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
});
