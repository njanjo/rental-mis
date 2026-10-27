import { describe, expect, it } from "vitest";

import { addMonths, parseDateInput, toDateInput } from "@/lib/dates";
import {
  normaliseKenyanPhone,
  formatKenyanPhone,
  isE164Kenyan,
} from "@/lib/phone";
import { moneyMinor, moneyMinorOrZero, parseMoneyInput, moneyInputValue } from "@/lib/validation/money";
import { propertySchema } from "@/lib/validation/property";
import { unitSchema } from "@/lib/validation/unit";
import { tenantSchema } from "@/lib/validation/tenant";
import { leaseCreateSchema, leaseTermsSchema } from "@/lib/validation/lease";
import {
  canTransitionMaintenance,
  maintenanceCreateSchema,
} from "@/lib/validation/maintenance";
import { formDataToValues, parseFormValues, stringValue } from "@/lib/validation/form";

describe("phone normalisation", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0712 345 678", "+254712345678"],
    ["712345678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+254712345678", "+254712345678"],
    ["(0712) 345-678", "+254712345678"],
    ["0112345678", "+254112345678"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseKenyanPhone(input)).toBe(expected);
    expect(isE164Kenyan(expected)).toBe(true);
  });

  it.each(["", "abc", "0812345678", "+255712345678", "071234567", "07123456789"])(
    "rejects %s",
    (input) => {
      expect(normaliseKenyanPhone(input)).toBeNull();
    },
  );

  it("formats for display", () => {
    expect(formatKenyanPhone("+254712345678")).toBe("+254 712 345 678");
  });
});

describe("money parsing", () => {
  it("converts KES to integer minor units", () => {
    expect(parseMoneyInput("15,000.50")).toBe(1_500_050);
    expect(parseMoneyInput("15000")).toBe(1_500_000);
    expect(parseMoneyInput("0.01")).toBe(1);
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("rejects malformed or negative amounts", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("-50")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("1,00.00")).toBeNull();
  });

  it("round-trips through the input formatter", () => {
    expect(moneyInputValue(1_500_050)).toBe("15,000.50");
  });

  it("validates required and zero-allowed amounts", () => {
    expect(moneyMinor.safeParse("15,000.00").success).toBe(true);
    expect(moneyMinor.safeParse("0").success).toBe(false);
    expect(moneyMinorOrZero.safeParse("0").success).toBe(true);
    expect(moneyMinor.safeParse("10,000,000.01").success).toBe(false);
  });
});

describe("date helpers", () => {
  it("parses YYYY-MM-DD as Nairobi midnight", () => {
    const date = parseDateInput("2026-03-05");
    expect(date?.toISOString()).toBe("2026-03-04T21:00:00.000Z");
    expect(toDateInput(date)).toBe("2026-03-05");
  });

  it("rejects impossible dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("05/03/2026")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });

  it("adds months with end-of-month clamping", () => {
    const jan31 = parseDateInput("2026-01-31")!;
    const feb = addMonths(jan31, 1);
    // The helper works in UTC on the instant, so Jan 31 21:00Z lands on Feb 28.
    expect(feb.getUTCDate()).toBe(28);
  });
});

describe("property schema", () => {
  const valid = {
    name: "Kilimani Heights",
    address: "Wood Avenue, Kilimani",
    county: "Nairobi",
    managerIds: ["staff_manager"],
  };

  it("accepts a valid property", () => {
    const parsed = propertySchema.parse(valid);
    expect(parsed.county).toBe("Nairobi");
    expect(parsed.managerIds).toEqual(["staff_manager"]);
  });

  it("rejects an unknown county and a short name", () => {
    expect(propertySchema.safeParse({ ...valid, county: "Atlantis" }).success).toBe(false);
    expect(propertySchema.safeParse({ ...valid, name: "K" }).success).toBe(false);
  });
});

describe("unit schema", () => {
  const valid = {
    propertyId: "prop_1",
    unitNumber: "a1",
    rentAmount: "45,000.00",
    depositAmount: "90,000",
    status: "vacant",
  };

  it("upper-cases the unit number and converts money", () => {
    const parsed = unitSchema.parse(valid);
    expect(parsed.unitNumber).toBe("A1");
    expect(parsed.rentAmount).toBe(4_500_000);
    expect(parsed.depositAmount).toBe(9_000_000);
  });

  it("rejects an invalid status", () => {
    expect(unitSchema.safeParse({ ...valid, status: "archived" }).success).toBe(false);
  });
});

describe("tenant schema", () => {
  const valid = {
    fullName: "Grace Wanjiru",
    phone: "0712 345 678",
    nationalIdLast4: "4821",
    status: "active",
    consentSms: true,
  };

  it("normalises the phone to E.164", () => {
    const parsed = tenantSchema.parse(valid);
    expect(parsed.phone).toBe("+254712345678");
  });

  it("rejects an invalid phone and a partial ID", () => {
    expect(tenantSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
    expect(tenantSchema.safeParse({ ...valid, nationalIdLast4: "12" }).success).toBe(false);
  });

  it("treats an empty national ID as absent", () => {
    const parsed = tenantSchema.parse({ ...valid, nationalIdLast4: "" });
    expect(parsed.nationalIdLast4).toBeUndefined();
  });
});

describe("lease schemas", () => {
  const valid = {
    tenantId: "tnt_1",
    unitId: "unit_1",
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    rentAmount: "45,000.00",
    depositAmount: "90,000.00",
    dueDay: "5",
  };

  it("parses dates to instants and coerces the due day", () => {
    const parsed = leaseCreateSchema.parse(valid);
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.dueDay).toBe(5);
    expect(parsed.rentAmount).toBe(4_500_000);
  });

  it("rejects an end date before the start date", () => {
    const result = leaseCreateSchema.safeParse({
      ...valid,
      endDate: "2025-12-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("endDate"))).toBe(true);
    }
  });

  it("rejects due days outside 1-28", () => {
    expect(leaseCreateSchema.safeParse({ ...valid, dueDay: "29" }).success).toBe(false);
    expect(leaseCreateSchema.safeParse({ ...valid, dueDay: "0" }).success).toBe(false);
  });

  it("requires a reason when terms change", () => {
    expect(
      leaseTermsSchema.safeParse({
        rentAmount: "50,000",
        depositAmount: "90,000",
        dueDay: "5",
        reason: "",
      }).success,
    ).toBe(false);
  });
});

describe("maintenance schema and transitions", () => {
  it("requires a meaningful title and a known priority", () => {
    const base = {
      propertyId: "prop_1",
      unitId: "unit_1",
      title: "Leaking sink",
      issue: "Water pooling under the cabinet",
      priority: "high",
    };
    expect(maintenanceCreateSchema.safeParse(base).success).toBe(true);
    expect(maintenanceCreateSchema.safeParse({ ...base, title: "Fix" }).success).toBe(false);
    expect(maintenanceCreateSchema.safeParse({ ...base, priority: "critical" }).success).toBe(false);
  });

  it("only moves forwards through the status machine", () => {
    expect(canTransitionMaintenance("open", "assigned")).toBe(true);
    expect(canTransitionMaintenance("open", "in_progress")).toBe(true);
    expect(canTransitionMaintenance("in_progress", "resolved")).toBe(true);
    expect(canTransitionMaintenance("resolved", "open")).toBe(false);
    expect(canTransitionMaintenance("cancelled", "open")).toBe(false);
    expect(canTransitionMaintenance("open", "open")).toBe(true);
  });
});

describe("form parsing", () => {
  it("keeps repeated values as arrays", () => {
    const form = new FormData();
    form.set("name", "Grace");
    form.append("managerIds", "a");
    form.append("managerIds", "b");
    const values = formDataToValues(form);
    expect(values.name).toBe("Grace");
    expect(values.managerIds).toEqual(["a", "b"]);
  });

  it("returns field errors from a failed schema", () => {
    const form = new FormData();
    form.set("name", "K");
    form.set("address", "");
    form.set("county", "Nairobi");
    const values = formDataToValues(form);
    const parsed = parseFormValues(propertySchema, {
      ...values,
      managerIds: [],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.state.fieldErrors?.name?.length).toBeGreaterThan(0);
      expect(stringValue(values, "county")).toBe("Nairobi");
    }
  });
});
