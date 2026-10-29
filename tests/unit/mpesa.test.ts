import { describe, expect, it } from "vitest";

import {
  callbackSecretMatches,
  formatMpesaAmount,
  mpesaRequestIdTimestamp,
  normaliseMsisdn,
  parseMpesaAmount,
  parseMpesaTransTime,
  payerNameFromC2B,
  stkAccountReference,
  stkPassword,
  stkSuccessFacts,
} from "@/lib/mpesa";

describe("parseMpesaAmount", () => {
  it("parses whole and fractional KES into cents", () => {
    expect(parseMpesaAmount("1000.00")).toBe(100_000);
    expect(parseMpesaAmount("15.5")).toBe(1_550);
    expect(parseMpesaAmount("0.01")).toBe(1);
    expect(parseMpesaAmount("1000")).toBe(100_000);
    expect(parseMpesaAmount(" 60 "))?.toBe(6_000);
  });

  it("rejects corrupt or absurd amounts", () => {
    expect(parseMpesaAmount("")).toBeNull();
    expect(parseMpesaAmount("1,000.00")).toBeNull();
    expect(parseMpesaAmount("1.234")).toBeNull();
    expect(parseMpesaAmount("abc")).toBeNull();
    expect(parseMpesaAmount("-1")).toBeNull();
    expect(parseMpesaAmount("1,2,3")).toBeNull();
    expect(parseMpesaAmount("99999999999")).toBeNull(); // above the typo guard
  });
});

describe("formatMpesaAmount", () => {
  it("round-trips minor units into Daraja-friendly strings", () => {
    expect(formatMpesaAmount(100_000)).toBe("1000");
    expect(formatMpesaAmount(15_050)).toBe("150.50");
  });
});

describe("parseMpesaTransTime", () => {
  it("interprets YYMMDDHHmmss as Nairobi (UTC+3) time", () => {
    const parsed = parseMpesaTransTime("261029143000");
    expect(parsed).not.toBeNull();
    // 14:30 Nairobi == 11:30 UTC.
    expect(parsed?.toISOString()).toBe("2026-10-29T11:30:00.000Z");
  });

  it("rejects malformed timestamps", () => {
    expect(parseMpesaTransTime("")).toBeNull();
    expect(parseMpesaTransTime("2610291430")).toBeNull();
    expect(parseMpesaTransTime("261299143000")).toBeNull();
    expect(parseMpesaTransTime("261029253000")).toBeNull();
  });
});

describe("payerNameFromC2B", () => {
  it("joins the parts and drops blanks", () => {
    expect(
      payerNameFromC2B({ FirstName: "Jane", MiddleName: "", LastName: "Wanjiku" }),
    ).toBe("Jane Wanjiku");
    expect(payerNameFromC2B({})).toBeUndefined();
  });
});

describe("normaliseMsisdn", () => {
  it("normalises MSISDNs into E.164", () => {
    expect(normaliseMsisdn("254712345678")).toBe("+254712345678");
    expect(normaliseMsisdn("0712345678")).toBe("+254712345678");
    expect(normaliseMsisdn("")).toBeNull();
  });
});

describe("stkSuccessFacts", () => {
  it("extracts a receipt when metadata is complete", () => {
    const facts = stkSuccessFacts(
      [
        { Name: "Amount", Value: 1000 },
        { Name: "MpesaReceiptNumber", Value: "QK71GHK9FL" },
        { Name: "PhoneNumber", Value: 254712345678 },
        { Name: "TransactionDate", Value: "261029143000" },
      ],
      new Date("2026-10-29T10:00:00Z"),
    );

    expect(facts).toEqual({
      amountMinor: 100_000,
      receiptNumber: "QK71GHK9FL",
      payerPhone: "+254712345678",
      transactionDate: new Date("2026-10-29T11:30:00.000Z"),
    });
  });

  it("falls back to the request time when metadata is partial", () => {
    const fallback = new Date("2026-10-29T10:00:00Z");
    const facts = stkSuccessFacts(
      [
        { Name: "Amount", Value: "500" },
        { Name: "MpesaReceiptNumber", Value: "QK71GHK9FL" },
      ],
      fallback,
    );

    expect(facts?.amountMinor).toBe(50_000);
    expect(facts?.payerPhone).toBeNull();
    expect(facts?.transactionDate).toBe(fallback);
  });

  it("returns null without amount or receipt (cannot record half a receipt)", () => {
    const fallback = new Date();
    expect(stkSuccessFacts([], fallback)).toBeNull();
    expect(
      stkSuccessFacts([{ Name: "Amount", Value: 5 }], fallback),
    ).toBeNull();
    expect(
      stkSuccessFacts(
        [
          { Name: "Amount", Value: 5 },
          { Name: "MpesaReceiptNumber", Value: "bad ref!" },
        ],
        fallback,
      ),
    ).toBeNull();
  });
});

describe("stk helpers", () => {
  it("builds the STK password from shortcode, passkey and timestamp", () => {
    expect(stkPassword("174379", "passkey", "20261029143000")).toBe(
      Buffer.from("174379passkey20261029143000").toString("base64"),
    );
  });

  it("produces a request timestamp in Nairobi wall clock (14 digits)", () => {
    // 11:30Z == 14:30 Nairobi on the same day.
    expect(mpesaRequestIdTimestamp(new Date("2026-10-29T11:30:00Z"))).toBe(
      "20261029143000",
    );
  });

  it("clamps account references to 12 alphanumeric characters", () => {
    expect(stkAccountReference("Jane Wanjiku")).toBe("JaneWanjiku");
    // First 12 kept after cleaning: unit codes survive if they lead.
    expect(stkAccountReference("BLDG1-UNIT-A102-2026-10")).toBe("BLDG1UNITA10");
    expect(stkAccountReference("   ")).toBe("RENT");
  });
});

describe("callbackSecretMatches", () => {
  it("is exact and timing-safe", () => {
    expect(callbackSecretMatches("abc", "abc")).toBe(true);
    expect(callbackSecretMatches("abc", "abd")).toBe(false);
    expect(callbackSecretMatches("abc", "abcd")).toBe(false);
    expect(callbackSecretMatches(undefined, "abc")).toBe(false);
    expect(callbackSecretMatches("abc", undefined)).toBe(false);
  });
});
