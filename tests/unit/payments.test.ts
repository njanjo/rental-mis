import { describe, expect, it } from "vitest";

import {
  normalisePaymentReference,
  paymentIdForReference,
  paymentReferenceKey,
  referenceOptional,
  REFERENCE_REQUIRED_PROVIDERS,
} from "@/lib/payments";

describe("normalisePaymentReference", () => {
  it("folds case and strips whitespace", () => {
    expect(normalisePaymentReference("  qgr7x2m9kl ")).toBe("QGR7X2M9KL");
    expect(normalisePaymentReference("SJK4 AB12\tXY")).toBe("SJK4AB12XY");
    expect(normalisePaymentReference("abc\n123")).toBe("ABC123");
  });

  it("leaves punctuation alone so distinct references stay distinct", () => {
    expect(normalisePaymentReference("A-1")).toBe("A-1");
    expect(normalisePaymentReference("A/1")).toBe("A/1");
  });
});

describe("paymentReferenceKey", () => {
  it("namespaces the reference by provider", () => {
    expect(paymentReferenceKey("mpesa", " abc ")).toBe("mpesa:ABC");
    expect(paymentReferenceKey("bank", "ABC")).toBe("bank:ABC");
  });
});

describe("paymentIdForReference", () => {
  it("is deterministic and insensitive to case and whitespace", () => {
    const first = paymentIdForReference("mpesa", "QGR7X2M9KL");
    expect(first).toBe(paymentIdForReference("mpesa", "qgr7x2m9kl"));
    expect(first).toBe(paymentIdForReference("mpesa", " QGR7X2M9KL "));
    expect(first).toMatch(/^pay_[0-9a-f]{24}$/);
  });

  it("separates providers and references", () => {
    expect(paymentIdForReference("mpesa", "ABC")).not.toBe(
      paymentIdForReference("bank", "ABC"),
    );
    expect(paymentIdForReference("mpesa", "ABC")).not.toBe(
      paymentIdForReference("mpesa", "ABD"),
    );
  });

  it("never leaks the raw reference into the id", () => {
    const id = paymentIdForReference("mpesa", "SJK4AB12XY");
    expect(id).not.toContain("SJK4AB12XY");
  });
});

describe("referenceOptional", () => {
  it("requires a reference for provider money and not for cash", () => {
    expect(REFERENCE_REQUIRED_PROVIDERS).toEqual(["mpesa", "bank"]);
    expect(referenceOptional("mpesa")).toBe(false);
    expect(referenceOptional("bank")).toBe(false);
    expect(referenceOptional("manual")).toBe(true);
  });
});
