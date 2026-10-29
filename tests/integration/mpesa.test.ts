import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { paymentIdForReference } from "@/lib/payments";
import type { RawMpesaC2bPayload, RawMpesaStkCallback } from "@/lib/validation/mpesa";
import {
  handleC2bConfirmation,
  handleC2bValidation,
  handleStkCallback,
  initiateStkPush,
} from "@/services/mpesa";

const db = () => adminDb();

const admin: SessionUser = {
  uid: "uid_admin",
  email: "admin@rentalmis.test",
  fullName: "Admin",
  role: "admin",
  active: true,
  propertyIds: [],
};

function c2bPayload(overrides: Partial<RawMpesaC2bPayload> = {}): RawMpesaC2bPayload {
  return {
    TransactionType: "Pay Bill",
    TransID: "RKT7DMQ6K8",
    TransTime: "261029143000",
    TransAmount: "45000.00",
    BusinessShortCode: process.env.MPESA_SHORTCODE ?? "174379",
    BillRefNumber: "A102",
    MSISDN: "254712345678",
    FirstName: "Grace",
    LastName: "Wanjiru",
    ...overrides,
  };
}

function stkPayload(overrides: Partial<RawMpesaStkCallback> = {}): RawMpesaStkCallback {
  return {
    MerchantRequestID: "29115-34620561-1",
    CheckoutRequestID: "ws_CO_DMZ_12321_2347679",
    ResultCode: 0,
    ResultDesc: "The service request is processed successfully.",
    CallbackMetadata: {
      Item: [
        { Name: "Amount", Value: 45000 },
        { Name: "MpesaReceiptNumber", Value: "QK71GHK9FL" },
        { Name: "PhoneNumber", Value: 254712345678 },
        { Name: "TransactionDate", Value: "261029143000" },
      ],
    },
    ...overrides,
  };
}

function stkRequestDoc(checkoutRequestId: string) {
  return db().collection("mpesaStkRequests").doc(`stk_${checkoutRequestId}`);
}

async function seedProperty(id: string, name: string): Promise<void> {
  await db()
    .collection("properties")
    .doc(id)
    .set({
      name,
      nameLower: name.toLowerCase(),
      address: "Test address",
      county: "Nairobi",
      managerIds: [],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedTenant(
  id: string,
  options: {
    fullName?: string;
    phoneE164?: string;
    propertyId?: string;
    status?: "active" | "inactive" | "former";
    indexActive?: boolean;
  } = {},
): Promise<void> {
  const propertyId = options.propertyId ?? "prop_1";
  const phone = options.phoneE164 ?? "+254712345678";
  const fullName = options.fullName ?? "Grace Wanjiru";

  await db()
    .collection("tenants")
    .doc(id)
    .set({
      fullName,
      fullNameLower: fullName.toLowerCase(),
      phoneE164: phone,
      status: options.status ?? "active",
      consentSms: true,
      propertyIds: [propertyId],
      currentPropertyId: propertyId,
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await db()
    .collection("tenantPhones")
    .doc(phone)
    .set({
      tenantId: id,
      active: options.indexActive ?? true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedInvoice(
  id: string,
  tenantId: string,
  propertyId: string,
): Promise<void> {
  await db()
    .collection("invoices")
    .doc(id)
    .set({
      tenantId,
      leaseId: `lease_${tenantId}`,
      unitId: `unit_${tenantId}`,
      propertyId,
      periodKey: "2026-10",
      dueDate: Timestamp.fromDate(new Date("2026-10-05T00:00:00Z")),
      amountDueMinor: 4_500_000,
      amountPaidMinor: 0,
      balanceMinor: 4_500_000,
      currency: "KES",
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedPortfolio(): Promise<void> {
  await seedProperty("prop_1", "Kilimani Heights");
  await seedProperty("prop_2", "Westlands Court");
  await seedTenant("tnt_1");
  await seedTenant("tnt_2", {
    fullName: "Peter Otieno",
    phoneE164: "+254723456789",
    propertyId: "prop_2",
  });
  await seedInvoice("inv_tnt_1", "tnt_1", "prop_1");
}

async function paymentData(id: string) {
  return (await db().collection("payments").doc(id).get()).data();
}

async function unmatchedData(id: string) {
  return (await db().collection("unmatchedPayments").doc(id).get()).data();
}

async function auditActions(entityId: string): Promise<string[]> {
  const snapshot = await db()
    .collection("auditLogs")
    .where("entityId", "==", entityId)
    .get();
  return snapshot.docs.map((doc) => doc.data().action as string);
}

async function count(collection: string): Promise<number> {
  return (await db().collection(collection).get()).size;
}

const ENV_KEYS = [
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_ENV",
  "MPESA_CALLBACK_BASE_URL",
  "MPESA_CALLBACK_SECRET",
] as const;

const envBackup = new Map<string, string | undefined>();

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    [
      "properties",
      "units",
      "tenants",
      "tenantPhones",
      "leases",
      "invoices",
      "payments",
      "paymentAllocations",
      "unmatchedPayments",
      "providerEvents",
      "mpesaStkRequests",
      "auditLogs",
      "users",
    ].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );

  // Daraja credentials are absent in CI; record them so each test can decide.
  ENV_KEYS.forEach((key) => envBackup.set(key, process.env[key]));
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  process.env.MPESA_CALLBACK_SECRET = "test-callback-secret-96-characters-of-random";
});

afterAll(() => {
  ENV_KEYS.forEach((key) => {
    const value = envBackup.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
});

describe("handleC2bConfirmation", () => {
  it("records and allocates a matched receipt, with its provider event", async () => {
    await seedPortfolio();

    const outcome = await handleC2bConfirmation(c2bPayload(), c2bPayload());

    expect(outcome.result).toBe("recorded");
    const paymentId = paymentIdForReference("mpesa", "RKT7DMQ6K8");
    expect(outcome.paymentId).toBe(paymentId);

    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({
      provider: "mpesa",
      providerTransactionId: "RKT7DMQ6K8",
      amountMinor: 4_500_000,
      tenantId: "tnt_1",
      propertyId: "prop_1",
      status: "allocated",
      source: "callback",
      payerName: "Grace Wanjiru",
      payerPhone: "+254712345678",
      confirmedBy: "system:mpesa",
    });

    // The invoice was fully settled.
    const invoice = (await db().collection("invoices").doc("inv_tnt_1").get()).data();
    expect(invoice).toMatchObject({
      amountPaidMinor: 4_500_000,
      balanceMinor: 0,
      status: "paid",
    });

    const event = (
      await db().collection("providerEvents").doc("c2bc_RKT7DMQ6K8").get()
    ).data();
    expect(event).toMatchObject({
      provider: "mpesa",
      kind: "c2b_confirmation",
      processingStatus: "processed",
    });

    expect(await auditActions(paymentId)).toContain("payment.recorded");
    expect(await count("unmatchedPayments")).toBe(0);
  });

  it("queues an unknown payer in the shared unmatched queue", async () => {
    await seedPortfolio();

    const outcome = await handleC2bConfirmation(
      c2bPayload({ TransID: "SMQ2NZ3XPB", MSISDN: "254799999999" }),
      null,
    );

    expect(outcome.result).toBe("queued");
    const paymentId = paymentIdForReference("mpesa", "SMQ2NZ3XPB");

    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({ status: "unmatched" });
    expect(payment?.tenantId).toBeUndefined();
    expect(payment?.propertyId).toBeUndefined();

    const row = await unmatchedData(`unm_${paymentId}`);
    expect(row).toMatchObject({ reason: expect.any(String), reviewStatus: "pending" });
    expect(row?.reason).toMatch(/match any active tenant phone/i);

    const event = (
      await db().collection("providerEvents").doc("c2bc_SMQ2NZ3XPB").get()
    ).data();
    expect(event?.processingStatus).toBe("processed");
  });

  it("queues a former tenant with their id as a candidate", async () => {
    await seedPortfolio();
    await db().collection("tenants").doc("tnt_1").update({ status: "former" });

    const outcome = await handleC2bConfirmation(c2bPayload(), null);
    expect(outcome.result).toBe("queued");

    const paymentId = paymentIdForReference("mpesa", "RKT7DMQ6K8");
    const row = await unmatchedData(`unm_${paymentId}`);
    expect(row?.candidateTenantIds).toEqual(["tnt_1"]);
    expect(row?.reason).toMatch(/no longer active/i);
  });

  it("returns duplicate without re-recording on a retried callback", async () => {
    await seedPortfolio();

    await handleC2bConfirmation(c2bPayload(), null);
    const first = await paymentData(paymentIdForReference("mpesa", "RKT7DMQ6K8"));

    const outcome = await handleC2bConfirmation(c2bPayload(), null);
    expect(outcome.result).toBe("duplicate");

    const second = await paymentData(paymentIdForReference("mpesa", "RKT7DMQ6K8"));
    expect(second?.updatedAt).toEqual(first?.updatedAt);
    expect(await count("payments")).toBe(1);
  });

  it("marks the provider event failed on unreadable money (route replies 500)", async () => {
    await seedPortfolio();

    const outcome = await handleC2bConfirmation(
      c2bPayload({ TransAmount: "45,000.00" }), // separator was never valid from Daraja
      null,
    );

    expect(outcome.result).toBe("failed");
    expect(await count("payments")).toBe(0);

    const event = (
      await db().collection("providerEvents").doc("c2bc_RKT7DMQ6K8").get()
    ).data();
    expect(event?.processingStatus).toBe("failed");
    expect(event?.error).toBeTruthy();
  });
});

describe("handleC2bValidation", () => {
  it("accepts a fresh receipt and stores the validation event", async () => {
    await seedPortfolio();

    const outcome = await handleC2bValidation(c2bPayload(), null);

    expect(outcome.result).toBe("recorded");
    expect(await count("payments")).toBe(0);

    const event = (
      await db().collection("providerEvents").doc("c2bv_RKT7DMQ6K8").get()
    ).data();
    expect(event?.processingStatus).toBe("processed");
  });

  it("flags a duplicate at validation time", async () => {
    await seedPortfolio();
    await handleC2bConfirmation(c2bPayload(), null);

    const outcome = await handleC2bValidation(c2bPayload(), null);

    expect(outcome.result).toBe("duplicate");
    expect(await count("payments")).toBe(1);
  });

  it("rejects a structurally broken amount", async () => {
    await seedPortfolio();

    const outcome = await handleC2bValidation(
      c2bPayload({ TransAmount: "45,000.00" }),
      null,
    );

    expect(outcome.result).toBe("rejected");
    expect(await count("payments")).toBe(0);
  });
});

describe("handleStkCallback", () => {
  const checkoutRequestId = "ws_CO_DMZ_12321_2347679";

  async function seedPending(options: { requestedBy?: string } = {}) {
    await seedPortfolio();
    await stkRequestDoc(checkoutRequestId).set({
      checkoutRequestId,
      merchantRequestId: "29115-34620561-1",
      phoneE164: "+254712345678",
      amountMinor: 4_500_000,
      tenantId: "tnt_1",
      requestedBy: options.requestedBy ?? "uid_manager",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  it("records the receipt and resolves the prompt on success", async () => {
    await seedPending();

    const outcome = await handleStkCallback(stkPayload(), null);

    expect(outcome.result).toBe("recorded");
    const paymentId = paymentIdForReference("mpesa", "QK71GHK9FL");
    expect(outcome.paymentId).toBe(paymentId);

    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({
      provider: "mpesa",
      providerTransactionId: "QK71GHK9FL",
      amountMinor: 4_500_000,
      tenantId: "tnt_1",
      status: "allocated",
      source: "callback",
    });

    const request = (await stkRequestDoc(checkoutRequestId).get()).data();
    expect(request).toMatchObject({
      status: "succeeded",
      resultCode: 0,
      paymentId,
    });
  });

  it("closes the prompt without recording money on failure", async () => {
    await seedPending();

    const outcome = await handleStkCallback(
      stkPayload({
        ResultCode: 1,
        ResultDesc: "Request cancelled by user",
        CallbackMetadata: undefined,
      }),
      null,
    );

    expect(outcome.result).toBe("recorded"); // The callback itself processed fine.
    expect(await count("payments")).toBe(0);

    const request = (await stkRequestDoc(checkoutRequestId).get()).data();
    expect(request).toMatchObject({
      status: "failed",
      resultCode: 1,
      resultDesc: "Request cancelled by user",
    });
  });

  it("treats a second callback as duplicate", async () => {
    await seedPending();

    await handleStkCallback(stkPayload(), null);
    const outcome = await handleStkCallback(stkPayload(), null);

    expect(outcome.result).toBe("duplicate");
    expect(await count("payments")).toBe(1);

    const event = (
      await db().collection("providerEvents").doc(`stk_${checkoutRequestId}`).get()
    ).data();
    expect(event?.processingStatus).toBe("duplicate");
  });

  it("stores unknown prompts as a failed event without inventing state", async () => {
    await seedPortfolio();

    const outcome = await handleStkCallback(stkPayload(), null);

    expect(outcome.result).toBe("failed");
    expect(await count("payments")).toBe(0);
    expect(await count("mpesaStkRequests")).toBe(0);

    const event = (
      await db().collection("providerEvents").doc(`stk_${checkoutRequestId}`).get()
    ).data();
    expect(event?.processingStatus).toBe("failed");
  });

  it("queues a receipt whose phone stopped matching", async () => {
    await seedPending();
    await db().collection("tenantPhones").doc("+254712345678").update({ active: false });

    const outcome = await handleStkCallback(stkPayload(), null);

    expect(outcome.result).toBe("queued");
    const paymentId = paymentIdForReference("mpesa", "QK71GHK9FL");
    const payment = await paymentData(paymentId);
    expect(payment).toMatchObject({ status: "unmatched" });
    expect(payment?.tenantId).toBeUndefined();
    expect(await unmatchedData(`unm_${paymentId}`)).toMatchObject({
      reviewStatus: "pending",
    });
  });
});

describe("initiateStkPush", () => {
  const checkoutRequestId = "ws_CO_DMZ_99999_234";

  function stubFetch(): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/v1/generate")) {
        return new Response(
          JSON.stringify({ access_token: "tok_1", expires_in: "3599" }),
          { status: 200 },
        );
      }
      if (url.includes("/mpesa/stkpush/v2/processrequest")) {
        return new Response(
          JSON.stringify({
            ResponseCode: "0",
            ResponseDescription: "Accept the service request successfully",
            MerchantRequestID: "29115-34620561-2",
            CheckoutRequestID: checkoutRequestId,
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it("creates the pending request document via Daraja", async () => {
    await seedPortfolio();

    process.env.MPESA_CONSUMER_KEY = "key";
    process.env.MPESA_CONSUMER_SECRET = "secret";
    process.env.MPESA_SHORTCODE = "174379";
    process.env.MPESA_PASSKEY = "passkey";
    process.env.MPESA_CALLBACK_BASE_URL = "https://rent.example.com";
    process.env.MPESA_CALLBACK_SECRET = "test-callback-secret-96-characters-of-random";

    const result = await initiateStkPush(
      admin,
      { phoneE164: "+254712345678", amountMinor: 4_500_000, tenantId: "tnt_1", accountId: "A102" },
      stubFetch(),
    );

    expect(result.checkoutRequestId).toBe(checkoutRequestId);

    const request = (await stkRequestDoc(checkoutRequestId).get()).data();
    expect(request).toMatchObject({
      status: "pending",
      phoneE164: "+254712345678",
      amountMinor: 4_500_000,
      tenantId: "tnt_1",
    });

    expect(await auditActions(`stk_${checkoutRequestId}`)).toContain(
      "mpesa.stk_requested",
    );
  });

  it("refuses to run without configured credentials", async () => {
    await seedPortfolio();

    await expect(
      initiateStkPush(
        admin,
        { phoneE164: "+254712345678", amountMinor: 4_500_000 },
        stubFetch(),
      ),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
