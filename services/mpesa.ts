import "server-only";

/**
 * M-Pesa ingestion: C2B paybill callbacks and STK Push prompts.
 *
 * Trust model: Daraja calls the app's webhook routes with a shared-secret path
 * segment. A browser request is never proof of payment — the provider event
 * receipt, payload hash and audit trail together are. Nothing here accepts
 * money without the deterministic payment id (idempotency) and, unless the
 * payer phone resolves to exactly one active tenant, the receipt goes to the
 * unmatched queue.
 *
 * Relationship to `services/payments.ts`: this module always runs inside its
 * own Firestore transaction, committing the payment, the provider event and
 * the audit entries together. Processing never loses the raw payload — even a
 * failed event is stored, so support can explain (and replay) it.
 */

import { createHash } from "node:crypto";

import {
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  formatMpesaAmount,
  mpesaRequestIdTimestamp,
  payerNameFromC2B,
  parseMpesaAmount,
  parseMpesaTransTime,
  stkAccountReference,
  stkPassword,
  stkSuccessFacts,
  type MpesaMetadataItem,
} from "@/lib/mpesa";
import { normaliseMsisdn } from "@/lib/mpesa";
import { paymentIdForReference } from "@/lib/payments";
import type {
  EventProcessingStatus,
  MpesaStkRequest,
  MpesaStkStatus,
  PaymentSource,
  ProviderEventKind,
  Tenant,
} from "@/lib/types";
import type {
  RawMpesaC2bPayload,
  RawMpesaStkCallback,
} from "@/lib/validation/mpesa";
import {
  confirmPaymentWithinTransaction,
  queueUnmatchedWithinTransaction,
} from "@/services/payments";

const PROVIDER_EVENTS_COLLECTION = "providerEvents";
const STK_COLLECTION = "mpesaStkRequests";
const PHONE_INDEX = "tenantPhones";
const TENANT_COLLECTION = "tenants";
const PAYMENT_COLLECTION = "payments";

/**
 * The webhook has no signed-in staff member, but downstream code (allocation,
 * audit, scope checks) speaks the `SessionUser` shape. Automation acts as a
 * scoped-out synthetic admin; the `system:` uid keeps every audit entry
 * self-explanatory and obviously apart from human work.
 */
export const MPESA_SYSTEM_ACTOR: SessionUser = {
  uid: "system:mpesa",
  email: "system@rentalmis.internal",
  fullName: "M-Pesa callback",
  role: "admin",
  active: true,
  propertyIds: [],
};

export interface CallbackOutcome {
  /** `failed` maps to HTTP 5xx so Daraja retries; everything else is 200. */
  result: "recorded" | "queued" | "duplicate" | "rejected" | "failed";
  resultDesc: string;
  paymentId?: string;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function eventDocId(kind: ProviderEventKind, reference: string): string {
  const prefix =
    kind === "stk_callback" ? "stk" : kind === "c2b_validation" ? "c2bv" : "c2bc";
  return `${prefix}_${reference}`;
}

/** Store the raw callback evidence with its processing state. */
async function recordEvent(
  kind: ProviderEventKind,
  reference: string,
  payload: unknown,
  status: EventProcessingStatus,
  error?: unknown,
): Promise<void> {
  const message =
    error === undefined
      ? undefined
      : (error instanceof Error ? error.message : String(error)).slice(0, 500);

  const fields: Record<string, unknown> = {
    provider: "mpesa" as const,
    kind,
    eventId: reference,
    payloadHash: hashPayload(payload),
    receivedAt: FieldValue.serverTimestamp(),
    processingStatus: status,
  };
  if (message !== undefined) fields.error = message;

  await adminDb()
    .collection(PROVIDER_EVENTS_COLLECTION)
    .doc(eventDocId(kind, reference))
    .set(fields, { mergeFields: [...Object.keys(fields)] });
}

function markEventProcessed(
  tx: Transaction,
  kind: ProviderEventKind,
  reference: string,
  payload: unknown,
): void {
  tx.set(
    adminDb().collection(PROVIDER_EVENTS_COLLECTION).doc(eventDocId(kind, reference)),
    {
      provider: "mpesa" as const,
      kind,
      eventId: reference,
      payloadHash: hashPayload(payload),
      receivedAt: FieldValue.serverTimestamp(),
      processingStatus: "processed" as const,
    },
  );
}

type TenantResolution =
  | { status: "matched"; tenant: Tenant }
  | { status: "no_phone_index" }
  | { status: "inactive"; tenant: Tenant }
  | { status: "no_property"; tenant: Tenant };

/**
 * Phone-only matching, identical in spirit to the statement importer: the
 * unique-active-phone index decides who paid; names and narrations are never
 * used to guess. The tenant must still be active and linked to a property.
 */
async function resolveTenant(
  tx: Transaction,
  payerPhone: string,
): Promise<TenantResolution> {
  const db = adminDb();

  const index = await tx.get(db.collection(PHONE_INDEX).doc(payerPhone));
  if (!index.exists) return { status: "no_phone_index" };

  const entry = index.data() as { tenantId?: string; active?: boolean } | undefined;
  if (!entry?.tenantId || entry.active !== true) {
    return { status: "no_phone_index" };
  }

  const tenantSnapshot = await tx.get(
    db.collection(TENANT_COLLECTION).doc(entry.tenantId),
  );
  if (!tenantSnapshot.exists) return { status: "no_phone_index" };

  const tenant = {
    ...(tenantSnapshot.data() as Tenant),
    // The document id is authoritative; `id` is not stored as a field.
    id: tenantSnapshot.id,
  };
  if (tenant.status !== "active") return { status: "inactive", tenant };

  const propertyId = tenant.currentPropertyId ?? tenant.propertyIds?.[0];
  if (!propertyId) return { status: "no_property", tenant };

  return { status: "matched", tenant };
}

function c2bReference(payload: RawMpesaC2bPayload): string {
  return payload.TransID.trim().toUpperCase();
}

function c2bPayerFields(payload: RawMpesaC2bPayload): {
  payerName?: string;
  payerPhone?: string;
  narration?: string;
} {
  return {
    payerName: payerNameFromC2B(payload),
    payerPhone: normaliseMsisdn(payload.MSISDN) ?? undefined,
    narration: payload.BillRefNumber?.trim()
      ? `Bill ref: ${payload.BillRefNumber.trim()}`
      : undefined,
  };
}

function c2bReceivedAt(payload: RawMpesaC2bPayload, fallback: Date): Date {
  return parseMpesaTransTime(payload.TransTime) ?? fallback;
}

function c2bReason(status: Exclude<TenantResolution, { status: "matched" }>["status"]): string {
  if (status === "no_phone_index") {
    return "Paybill confirmation did not match any active tenant phone.";
  }
  if (status === "inactive") {
    return "Payer phone belongs to a tenant who is no longer active.";
  }
  return "Tenant matched by phone has no linked property.";
}

/** Where the queue offers candidate tenants, a resolution may carry one. */
function candidateTenantIds(tenant: Tenant | undefined): string[] {
  return tenant ? [tenant.id] : [];
}

// ---------------------------------------------------------------------------
// C2B validation
// ---------------------------------------------------------------------------

/**
 * Answer the validation callback. Money has not moved at validation time, so
 * payments are only refused for structural reasons: an unparseable amount or
 * MSISDN (corrupt callback), or a receipt we have already recorded once.
 * Everything else is accepted here and resolved on confirmation.
 */
export async function handleC2bValidation(
  payload: RawMpesaC2bPayload,
  raw: unknown,
): Promise<CallbackOutcome> {
  const reference = c2bReference(payload);
  const paymentId = paymentIdForReference("mpesa", reference);

  try {
    const amountMinor = parseMpesaAmount(payload.TransAmount);
    const payerPhone = normaliseMsisdn(payload.MSISDN);
    if (amountMinor === null || amountMinor <= 0 || !payerPhone) {
      return {
        result: "rejected",
        resultDesc: "Callback fields could not be read. Payment refused.",
      };
    }

    const exists = await adminDb()
      .collection(PAYMENT_COLLECTION)
      .doc(paymentId)
      .get();
    if (exists.exists) {
      await recordEvent("c2b_validation", reference, raw, "duplicate");
      return {
        result: "duplicate",
        resultDesc: "That receipt has already been recorded.",
      };
    }

    // Validation evidence is advisory; confirmation is the receipt, so a
    // failure to store this event never cancels a tenant's rent.
    try {
      await recordEvent("c2b_validation", reference, raw, "processed");
    } catch {
      // Ignore: nothing depends on validation events.
    }

    return { result: "recorded", resultDesc: "Accept payment" };
  } catch {
    // Only the replay-safe duplicate check lives before this; any thrown
    // failure is infrastructure, so leave the validation unanswered.
    return { result: "failed", resultDesc: "Unable to process request." };
  }
}

// ---------------------------------------------------------------------------
// C2B confirmation
// ---------------------------------------------------------------------------

/**
 * Confirmation is where money is recorded. The payment, provider event and
 * audit entries commit in one transaction; an unexpected failure marks the
 * provider event `failed` (never loses the raw payload) and surfaces as an
 * outcome the route turns into a retryable HTTP 500.
 */
export async function handleC2bConfirmation(
  payload: RawMpesaC2bPayload,
  raw: unknown,
): Promise<CallbackOutcome> {
  const reference = c2bReference(payload);
  const db = adminDb();
  const eventRef = db
    .collection(PROVIDER_EVENTS_COLLECTION)
    .doc(eventDocId("c2b_confirmation", reference));

  try {
    const outcome = await db.runTransaction(async (tx): Promise<CallbackOutcome> => {
      const paymentId = paymentIdForReference("mpesa", reference);
      const payer = c2bPayerFields(payload);
      const receivedAt = c2bReceivedAt(payload, new Date());

      const existingPayment = await tx.get(
        db.collection(PAYMENT_COLLECTION).doc(paymentId),
      );
      if (existingPayment.exists) {
        tx.set(eventRef, {
          provider: "mpesa" as const,
          kind: "c2b_confirmation" satisfies ProviderEventKind,
          eventId: reference,
          payloadHash: hashPayload(raw),
          receivedAt: FieldValue.serverTimestamp(),
          processingStatus: "duplicate" as const,
        });
        return { result: "duplicate", resultDesc: "Already recorded." };
      }

      const amountMinor = parseMpesaAmount(payload.TransAmount);
      const payerPhone = normaliseMsisdn(payload.MSISDN);
      if (amountMinor === null || amountMinor <= 0 || !payerPhone) {
        throw new ServiceError(
          "validation",
          "Callback amount or MSISDN could not be read.",
        );
      }

      const resolution = await resolveTenant(tx, payerPhone);

      if (resolution.status === "matched") {
        const result = await confirmPaymentWithinTransaction(tx, MPESA_SYSTEM_ACTOR, {
          provider: "mpesa" as const,
          providerTransactionId: reference,
          amountMinor,
          receivedAt,
          tenantId: resolution.tenant.id,
          source: "callback" satisfies PaymentSource,
          ...payer,
          payerPhone,
        });

        markEventProcessed(tx, "c2b_confirmation", reference, raw);
        return {
          result: "recorded",
          resultDesc: "Accepted",
          paymentId: result?.paymentId ?? paymentId,
        };
      }

      await queueUnmatchedWithinTransaction(tx, MPESA_SYSTEM_ACTOR, {
        provider: "mpesa" as const,
        providerTransactionId: reference,
        amountMinor,
        receivedAt,
        source: "callback" satisfies PaymentSource,
        reason: c2bReason(resolution.status),
        candidateTenantIds: candidateTenantIds(
          "tenant" in resolution ? resolution.tenant : undefined,
        ),
        ...payer,
        payerPhone,
      });

      markEventProcessed(tx, "c2b_confirmation", reference, raw);
      return { result: "queued", resultDesc: "Accepted — queued for review" };
    });

    return outcome;
  } catch (error) {
    await recordEvent("c2b_confirmation", reference, raw, "failed", error);
    return { result: "failed", resultDesc: "Unable to process receipt." };
  }
}

// ---------------------------------------------------------------------------
// STK Push callbacks
// ---------------------------------------------------------------------------

function stkDocId(checkoutRequestId: string): string {
  return `stk_${checkoutRequestId}`;
}

/**
 * Resolve an STK callback. Success records the receipt through the same
 * matching rules as a C2B confirmation; failure (customer cancelled, timed
 * out, insufficient funds) never touches money and closes the prompt record.
 * A callback for an unknown prompt is stored as a failed event — evidence
 * beats inventing request state.
 */
export async function handleStkCallback(
  payload: RawMpesaStkCallback,
  raw: unknown,
): Promise<CallbackOutcome> {
  const db = adminDb();
  const reference = payload.CheckoutRequestID;

  try {
    const outcome = await db.runTransaction(async (tx): Promise<CallbackOutcome> => {
      const requestRef = db.collection(STK_COLLECTION).doc(stkDocId(reference));
      const requestSnapshot = await tx.get(requestRef);

      if (requestSnapshot.exists) {
        const request = requestSnapshot.data() as MpesaStkRequest;
        if (request.status !== "pending") {
          tx.set(
            db.collection(PROVIDER_EVENTS_COLLECTION).doc(eventDocId("stk_callback", reference)),
            {
              provider: "mpesa" as const,
              kind: "stk_callback" satisfies ProviderEventKind,
              eventId: reference,
              payloadHash: hashPayload(raw),
              receivedAt: FieldValue.serverTimestamp(),
              processingStatus: "duplicate" as const,
            },
          );
          return { result: "duplicate", resultDesc: "Prompt already resolved." };
        }
      } else {
        throw new ServiceError("internal", "Callback for an unknown STK prompt.");
      }

      const request = requestSnapshot.data() as MpesaStkRequest;

      if (payload.ResultCode !== 0) {
        tx.update(requestRef, {
          status: "failed" satisfies MpesaStkStatus,
          resultCode: payload.ResultCode,
          resultDesc: payload.ResultDesc,
          updatedAt: FieldValue.serverTimestamp(),
        });
        markEventProcessed(tx, "stk_callback", reference, raw);
        return { result: "recorded", resultDesc: "Prompt did not succeed." };
      }

      const receivedAtFallback = new Date();
      const facts = stkSuccessFacts(
        (payload.CallbackMetadata?.Item ?? []) as MpesaMetadataItem[],
        receivedAtFallback,
      );
      if (!facts) {
        throw new ServiceError(
          "internal",
          "Successful STK callback did not carry usable receipt metadata.",
        );
      }

      const payerPhone = facts.payerPhone ?? request.phoneE164;
      const resolution = await resolveTenant(tx, payerPhone);

      let recordedPaymentId = paymentIdForReference("mpesa", facts.receiptNumber);

      if (resolution.status === "matched") {
        const result = await confirmPaymentWithinTransaction(tx, MPESA_SYSTEM_ACTOR, {
          provider: "mpesa" as const,
          providerTransactionId: facts.receiptNumber,
          amountMinor: facts.amountMinor,
          receivedAt: facts.transactionDate ?? receivedAtFallback,
          tenantId: resolution.tenant.id,
          source: "callback" satisfies PaymentSource,
          payerName: request.requestedByName,
          payerPhone,
        });
        recordedPaymentId = result?.paymentId ?? recordedPaymentId;
      } else {
        await queueUnmatchedWithinTransaction(tx, MPESA_SYSTEM_ACTOR, {
          provider: "mpesa" as const,
          providerTransactionId: facts.receiptNumber,
          amountMinor: facts.amountMinor,
          receivedAt: facts.transactionDate ?? receivedAtFallback,
          source: "callback" satisfies PaymentSource,
          reason: c2bReason(resolution.status),
          candidateTenantIds: candidateTenantIds(
            "tenant" in resolution ? resolution.tenant : undefined,
          ),
          payerPhone,
        });
      }

      const matched = resolution.status === "matched";
      tx.update(requestRef, {
        status: "succeeded" satisfies MpesaStkStatus,
        resultCode: 0,
        resultDesc: payload.ResultDesc,
        paymentId: recordedPaymentId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      markEventProcessed(tx, "stk_callback", reference, raw);
      return {
        result: matched ? "recorded" : "queued",
        resultDesc: matched ? "Accepted" : "Accepted — queued for review",
        paymentId: recordedPaymentId,
      };
    });

    return outcome;
  } catch (error) {
    await recordEvent("stk_callback", reference, raw, "failed", error);
    return { result: "failed", resultDesc: "Unable to process prompt result." };
  }
}

// ---------------------------------------------------------------------------
// Daraja client (access token + STK initiate)
// ---------------------------------------------------------------------------

interface DarajaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
}

function assertDarajaConfig(): DarajaConfig {
  const consumerKey = process.env.MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET?.trim();
  const shortcode = process.env.MPESA_SHORTCODE?.trim();
  const passkey = process.env.MPESA_PASSKEY?.trim();
  const environment = process.env.MPESA_ENV?.trim().toLowerCase() ?? "sandbox";

  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    throw new ServiceError(
      "validation",
      "M-Pesa STK Push is not configured. Add the Daraja credentials to the server environment.",
    );
  }

  return {
    baseUrl:
      environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke",
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function darajaAccessToken(
  config: DarajaConfig,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const url = `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`,
  ).toString("base64");

  const response = await fetchImpl(url, {
    headers: { Authorization: `Basic ${credentials}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ServiceError(
      "internal",
      "Daraja rejected the application credentials. Check the consumer key and secret.",
    );
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: string };
  const token = body.access_token;
  const lifetime = Number(body.expires_in ?? "3599");
  if (!token || !Number.isFinite(lifetime)) {
    throw new ServiceError("internal", "Daraja returned an unreadable access token.");
  }

  cachedToken = { value: token, expiresAt: Date.now() + Math.max(30, lifetime - 60) * 1000 };
  return token;
}

export interface StkRequestMappingResult {
  checkoutRequestId: string;
  merchantRequestId: string;
}

/**
 * Ask a phone for a rent payment prompt. Daraja answers immediately; the
 * customer's PIN (or their refusal) arrives later on `/api/mpesa/stk/[secret]`,
 * which resolves the request document created here.
 *
 * `fetchImpl` exists so tests can simulate Daraja without network access.
 */
export async function initiateStkPush(
  actor: SessionUser,
  input: {
    phoneE164: string;
    amountMinor: number;
    tenantId?: string;
    accountId?: string;
    note?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<StkRequestMappingResult> {
  const config = assertDarajaConfig();

  const baseUrl = process.env.MPESA_CALLBACK_BASE_URL?.trim();
  if (!baseUrl) {
    throw new ServiceError(
      "validation",
      "MPESA_CALLBACK_BASE_URL is not set, so Daraja has nowhere to send the result.",
    );
  }

  const secret = process.env.MPESA_CALLBACK_SECRET?.trim() ?? "";
  if (secret.length < 16) {
    throw new ServiceError(
      "validation",
      "MPESA_CALLBACK_SECRET is too short. Generate a random path segment before enabling STK Push.",
    );
  }

  const callbackUrl = `${baseUrl.replace(/\/+$/, "")}/api/mpesa/stk/${secret}`;
  const timestamp = mpesaRequestIdTimestamp(new Date());
  const password = stkPassword(config.shortcode, config.passkey, timestamp);

  const response = await fetchImpl(
    `${config.baseUrl}/mpesa/stkpush/v2/processrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await darajaAccessToken(config, fetchImpl)}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: formatMpesaAmount(input.amountMinor),
        PartyA: input.phoneE164.replace(/^\+/, ""),
        PartyB: config.shortcode,
        PhoneNumber: input.phoneE164.replace(/^\+/, ""),
        CallBackURL: callbackUrl,
        AccountReference: stkAccountReference(input.accountId ?? "Rent"),
        TransactionDesc: input.note?.slice(0, 60) || "Rent payment",
      }),
    },
  );

  if (!response.ok) {
    throw new ServiceError(
      "internal",
      "Daraja rejected the payment prompt. Check the phone number and amount.",
    );
  }

  const body = (await response.json()) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    errorMessage?: string;
  };

  if (body.ResponseCode !== "0" || !body.CheckoutRequestID || !body.MerchantRequestID) {
    throw new ServiceError(
      "internal",
      body.errorMessage ??
        body.ResponseDescription ??
        "Daraja did not accept the payment prompt.",
    );
  }

  const db = adminDb();
  const docId = stkDocId(body.CheckoutRequestID);
  const requestRef = db.collection(STK_COLLECTION).doc(docId);

  await db.runTransaction(async (tx) => {
    tx.set(requestRef, {
      checkoutRequestId: body.CheckoutRequestID,
      merchantRequestId: body.MerchantRequestID,
      phoneE164: input.phoneE164,
      amountMinor: input.amountMinor,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      requestedBy: actor.uid,
      status: "pending" satisfies MpesaStkStatus,
      ...(input.note ? { note: input.note } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeAuditLog(tx, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "mpesa.stk_requested",
      entityType: "mpesaStkRequest",
      entityId: docId,
      after: {
        phoneE164: input.phoneE164,
        amountMinor: input.amountMinor,
        tenantId: input.tenantId,
        checkoutRequestId: body.CheckoutRequestID,
      },
      reason: input.note,
    });
  });

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
  };
}
