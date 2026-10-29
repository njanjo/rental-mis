import { describe, expect, it } from "vitest";

import {
  beamMessageIdFromSend,
  beamRecipient,
  beamSendPayload,
  beamStatusForReport,
  defaultSmsVariables,
  receiptBalanceNote,
  renderSmsBody,
  reportsFromBeamList,
  smsBackoffMinutes,
} from "@/lib/sms";
import { DEFAULT_SMS_TEMPLATES } from "@/lib/sms";

describe("renderSmsBody", () => {
  it("replaces slots and trims the leftovers", () => {
    expect(
      renderSmsBody("Hello {{name}}, rent {{amount}} due {{dueDate}}.", {
        name: "Grace",
        amount: "KES 15,000.00",
        dueDate: "2026-11-05",
      }),
    ).toBe("Hello Grace, rent KES 15,000.00 due 2026-11-05.");
  });

  it("removes unfilled slots instead of leaving {{variables}}", () => {
    expect(renderSmsBody("Thank you. {{balanceNote}}", {})).toBe("Thank you.");
  });
});

describe("receiptBalanceNote", () => {
  it("explains the remaining balance in KES", () => {
    expect(receiptBalanceNote(0)).toBe("Balance: none.");
    expect(receiptBalanceNote(150_000)).toBe(String(receiptBalanceNote(150_000)));
    expect(receiptBalanceNote(150_000)).toMatch(/^Balance: Ksh/);
  });
});

describe("defaultSmsVariables", () => {
  it("fills receipt variables", () => {
    const vars = defaultSmsVariables("payment_receipt", {
      reference: "RKT7DMQ6K8",
      dateInput: "2026-10-29",
      moneyMinor: 4_500_000,
      balanceMinor: 0,
    });
    expect(vars.reference).toBe("RKT7DMQ6K8");
    expect(vars.date).toBe("2026-10-29");
    expect(vars.balanceNote).toBe("Balance: none.");
    expect(vars.amount).toMatch(/Ksh\D*45,000/);
  });

  it("fills reminder variables including first name and due date", () => {
    const vars = defaultSmsVariables("rent_due_reminder", {
      tenantName: "Grace Wanjiru",
      reference: "inv_1",
      dateInput: "2026-10-29",
      moneyMinor: 4_500_000,
      dueDate: "2026-11-05",
    });
    expect(vars.name).toBe("Grace Wanjiru");
    expect(vars.dueDate).toBe("2026-11-05");
    expect(vars.amount).toMatch(/Ksh\D*45,000/);
    expect(vars.balanceNote).toBe("");
  });
});

describe("Beam send payload", () => {
  it("normalises the recipient to a bare msisdn", () => {
    expect(beamRecipient("+254712345678")).toBe("254712345678");
  });

  it("builds the documented request body", () => {
    expect(beamSendPayload("+254712345678", "Hello", "RENTMIS")).toEqual({
      recipient: "254712345678",
      sender_id: "RENTMIS",
      type: "plain",
      message: "Hello",
    });
  });
});

describe("beamMessageIdFromSend", () => {
  it("extracts a uid-shaped data string or object", () => {
    expect(
      beamMessageIdFromSend({ status: "success", data: "606812e63f78b" }),
    ).toBe("606812e63f78b");
    expect(
      beamMessageIdFromSend({ status: "success", data: { uid: "abc123456789" } }),
    ).toBe("abc123456789");
    // Prose instead of an uid is not an id.
    expect(
      beamMessageIdFromSend({
        status: "success",
        data: "sms reports with all details",
      }),
    ).toBeUndefined();
  });

  it("returns nothing on error responses", () => {
    expect(beamMessageIdFromSend({ status: "error", message: "Denied" })).toBeUndefined();
    expect(beamMessageIdFromSend(null)).toBeUndefined();
  });
});

describe("delivery report mapping", () => {
  it("maps Beam words onto stored statuses", () => {
    expect(beamStatusForReport("Delivered")).toBe("delivered");
    expect(beamStatusForReport("FAILED: no route")).toBe("failed");
    expect(beamStatusForReport("Scheduled 2021-12-20")).toBe("sent");
    expect(beamStatusForReport("mystery")).toBeUndefined();
  });

  it("reads per-message rows from a list response", () => {
    expect(
      reportsFromBeamList({
        data: [
          { uid: "606812e63f78b", status: "Delivered" },
          { id: "second5678901", status: { name: "Failed" } },
          { uid: "", status: "Delivered" }, // no uid -> skipped
          "junk",
        ],
      }),
    ).toEqual([
      { uid: "606812e63f78b", rawStatus: "Delivered", status: "delivered" },
      { uid: "second5678901", rawStatus: "Failed", status: "failed" },
    ]);
  });
});

describe("retry backoff", () => {
  it("grows exponentially and caps at 6 hours", () => {
    expect(smsBackoffMinutes(1)).toBe(5);
    expect(smsBackoffMinutes(2)).toBe(20);
    expect(smsBackoffMinutes(3)).toBe(80);
    expect(smsBackoffMinutes(4)).toBe(320);
    expect(smsBackoffMinutes(5)).toBe(360);
  });
});

describe("default templates", () => {
  it("render clean messages end-to-end", () => {
    const receipt = renderSmsBody(
      DEFAULT_SMS_TEMPLATES.payment_receipt,
      defaultSmsVariables("payment_receipt", {
        reference: "RKT7DMQ6K8",
        dateInput: "2026-10-29",
        moneyMinor: 4_500_000,
        balanceMinor: 200_000,
      }),
    );
    expect(receipt).toContain("RKT7DMQ6K8");
    expect(receipt).toMatch(/Ksh\D*45,000/);
    expect(receipt).not.toContain("{{");

    const arreas = renderSmsBody(
      DEFAULT_SMS_TEMPLATES.arrears_notice,
      defaultSmsVariables("arrears_notice", {
        tenantName: "Grace",
        reference: "inv_1",
        dateInput: "2026-10-29",
        moneyMinor: 4_500_000,
      }),
    );
    expect(arreas).toContain("Grace");
    expect(arreas).not.toContain("{{");
  });
});
