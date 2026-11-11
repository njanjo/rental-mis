import { describe, expect, it } from "vitest";

import {
  billingRulesSchema,
  reminderRulesSchema,
  smsTemplatesSchema,
  staffInviteSchema,
  staffRoleScopeSchema,
} from "@/lib/validation/settings";

describe("billing rules schema", () => {
  const valid = {
    allocationStrategy: "oldest_first",
    overpayment: "tenant_credit",
    lateFeeEnabled: true,
    lateFeeAmount: "1,500.00",
    gracePeriodDays: "7",
    invoiceGenerationDay: "1",
  };

  it("parses form strings into typed values and minor units", () => {
    expect(billingRulesSchema.parse(valid)).toEqual({
      allocationStrategy: "oldest_first",
      overpayment: "tenant_credit",
      lateFeeEnabled: true,
      lateFeeAmount: 150_000,
      gracePeriodDays: 7,
      invoiceGenerationDay: 1,
    });
  });

  it("only accepts the form's allocation and overpayment policies", () => {
    // `manual` allocation exists on the type but stays out of the form.
    expect(
      billingRulesSchema.safeParse({ ...valid, allocationStrategy: "manual" })
        .success,
    ).toBe(false);
    expect(
      billingRulesSchema.safeParse({ ...valid, overpayment: "refund" }).success,
    ).toBe(false);
  });

  it("requires a late fee amount when late fees are enabled", () => {
    const result = billingRulesSchema.safeParse({
      ...valid,
      lateFeeAmount: "0",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes("lateFeeAmount")),
      ).toBe(true);
    }
  });

  it("allows a zero late fee when late fees are disabled", () => {
    const parsed = billingRulesSchema.parse({
      ...valid,
      lateFeeEnabled: false,
      lateFeeAmount: "0",
    });
    expect(parsed.lateFeeEnabled).toBe(false);
    expect(parsed.lateFeeAmount).toBe(0);
  });

  it("bounds the grace period to whole days between 0 and 60", () => {
    expect(
      billingRulesSchema.safeParse({ ...valid, gracePeriodDays: "0" }).success,
    ).toBe(true);
    expect(
      billingRulesSchema.safeParse({ ...valid, gracePeriodDays: "60" }).success,
    ).toBe(true);
    expect(
      billingRulesSchema.safeParse({ ...valid, gracePeriodDays: "61" }).success,
    ).toBe(false);
    expect(
      billingRulesSchema.safeParse({ ...valid, gracePeriodDays: "abc" })
        .success,
    ).toBe(false);
    expect(
      billingRulesSchema.safeParse({ ...valid, gracePeriodDays: "7.5" })
        .success,
    ).toBe(false);
  });

  it("bounds the invoice generation day to 1-28", () => {
    expect(
      billingRulesSchema.safeParse({ ...valid, invoiceGenerationDay: "1" })
        .success,
    ).toBe(true);
    expect(
      billingRulesSchema.safeParse({ ...valid, invoiceGenerationDay: "28" })
        .success,
    ).toBe(true);
    expect(
      billingRulesSchema.safeParse({ ...valid, invoiceGenerationDay: "0" })
        .success,
    ).toBe(false);
    expect(
      billingRulesSchema.safeParse({ ...valid, invoiceGenerationDay: "29" })
        .success,
    ).toBe(false);
    expect(
      billingRulesSchema.safeParse({ ...valid, invoiceGenerationDay: "1.5" })
        .success,
    ).toBe(false);
  });
});

describe("reminder rules schema", () => {
  const valid = { dueSoonDaysBefore: "3", overdueRepeatDays: "7" };

  it("parses form strings into whole-day windows", () => {
    expect(reminderRulesSchema.parse(valid)).toEqual({
      dueSoonDaysBefore: 3,
      overdueRepeatDays: 7,
    });
  });

  it("bounds the reminder windows", () => {
    expect(
      reminderRulesSchema.safeParse({ ...valid, dueSoonDaysBefore: "0" })
        .success,
    ).toBe(true);
    expect(
      reminderRulesSchema.safeParse({ ...valid, dueSoonDaysBefore: "14" })
        .success,
    ).toBe(true);
    expect(
      reminderRulesSchema.safeParse({ ...valid, dueSoonDaysBefore: "15" })
        .success,
    ).toBe(false);
    expect(
      reminderRulesSchema.safeParse({ ...valid, overdueRepeatDays: "1" })
        .success,
    ).toBe(true);
    expect(
      reminderRulesSchema.safeParse({ ...valid, overdueRepeatDays: "30" })
        .success,
    ).toBe(true);
    expect(
      reminderRulesSchema.safeParse({ ...valid, overdueRepeatDays: "0" })
        .success,
    ).toBe(false);
    expect(
      reminderRulesSchema.safeParse({ ...valid, overdueRepeatDays: "31" })
        .success,
    ).toBe(false);
  });
});

describe("sms templates schema", () => {
  const template = (
    key: string,
    body = "Hello {{name}}, this is your rent notice.",
  ) => ({ key, body, enabled: true });

  it("accepts the three editable templates", () => {
    const parsed = smsTemplatesSchema.parse([
      template("payment_receipt"),
      template("rent_due_reminder"),
      template("arrears_notice"),
    ]);
    expect(parsed.map((entry) => entry.key)).toEqual([
      "payment_receipt",
      "rent_due_reminder",
      "arrears_notice",
    ]);
    expect(parsed.every((entry) => entry.enabled)).toBe(true);
  });

  it("requires every editable key to be present", () => {
    expect(
      smsTemplatesSchema.safeParse([
        template("payment_receipt"),
        template("rent_due_reminder"),
      ]).success,
    ).toBe(false);
  });

  it("rejects keys outside the editable set", () => {
    expect(
      smsTemplatesSchema.safeParse([
        template("payment_receipt"),
        template("rent_due_reminder"),
        template("bulk_announcement"),
      ]).success,
    ).toBe(false);
  });

  it("caps the list at the editable templates", () => {
    expect(
      smsTemplatesSchema.safeParse([
        template("payment_receipt"),
        template("rent_due_reminder"),
        template("arrears_notice"),
        template("payment_receipt"),
      ]).success,
    ).toBe(false);
  });

  it("bounds the body length", () => {
    const withBody = (body: string) => [
      template("payment_receipt", body),
      template("rent_due_reminder", body),
      template("arrears_notice", body),
    ];
    expect(smsTemplatesSchema.safeParse(withBody("Too short")).success).toBe(
      false,
    );
    expect(
      smsTemplatesSchema.safeParse(withBody("x".repeat(480))).success,
    ).toBe(true);
    expect(
      smsTemplatesSchema.safeParse(withBody("x".repeat(481))).success,
    ).toBe(false);
  });
});

describe("staff invite schema", () => {
  const valid = {
    fullName: "Grace Wanjiru",
    email: "Grace@Example.COM",
    role: "property_manager",
    phoneE164: "+254712345678",
    propertyIds: ["prop_a"],
  };

  it("lower-cases the email", () => {
    expect(staffInviteSchema.parse(valid).email).toBe("grace@example.com");
  });

  it("rejects a malformed email", () => {
    expect(
      staffInviteSchema.safeParse({ ...valid, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("bounds the full name", () => {
    expect(
      staffInviteSchema.safeParse({ ...valid, fullName: "G" }).success,
    ).toBe(false);
    expect(
      staffInviteSchema.safeParse({ ...valid, fullName: "G".repeat(121) })
        .success,
    ).toBe(false);
  });

  it("rejects roles outside the matrix", () => {
    expect(
      staffInviteSchema.safeParse({ ...valid, role: "owner" }).success,
    ).toBe(false);
  });

  it("treats an empty phone as absent", () => {
    expect(
      staffInviteSchema.parse({ ...valid, phoneE164: "" }).phoneE164,
    ).toBeUndefined();
  });

  it("defaults the property scope to an empty list", () => {
    const parsed = staffInviteSchema.parse({
      fullName: valid.fullName,
      email: valid.email,
      role: valid.role,
    });
    expect(parsed.propertyIds).toEqual([]);
  });
});

describe("staff role scope schema", () => {
  it("defaults the scope to an empty list and validates the role", () => {
    expect(staffRoleScopeSchema.parse({ role: "finance" })).toEqual({
      role: "finance",
      propertyIds: [],
    });
    expect(
      staffRoleScopeSchema.safeParse({ role: "owner", propertyIds: [] })
        .success,
    ).toBe(false);
  });
});
