"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import {
  formSuccess,
  ServiceError,
  toFormState,
  type FormState,
} from "@/lib/errors";
import { parseFormValues, stringValue } from "@/lib/validation/form";
import {
  manualReceiptSchema,
  paymentReverseSchema,
  unmatchedIgnoreSchema,
  unmatchedResolveSchema,
} from "@/lib/validation/payment";
import {
  ignoreUnmatched,
  recordManualReceipt,
  resolveUnmatched,
  reversePayment,
} from "@/services/payments";
import { getTenant } from "@/services/tenants";
import { initiateStkPush } from "@/services/mpesa";
import { stkPushRequestSchema } from "@/lib/validation/mpesa";

function requiredId(formData: FormData, field: string, label: string): string {
  const value = stringValue(formData, field);
  if (!value) {
    throw new ServiceError("validation", `Missing ${label}.`);
  }
  return value;
}

function revalidatePaymentSurfaces(paymentId?: string, tenantId?: string): void {
  revalidatePath("/payments");
  revalidatePath("/payments/unmatched");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  if (paymentId) revalidatePath(`/payments/${paymentId}`);
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
}

export async function recordManualReceiptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "enter_manual_receipts");

    const parsed = parseFormValues(manualReceiptSchema, {
      tenantId: stringValue(formData, "tenantId"),
      amount: stringValue(formData, "amount"),
      provider: stringValue(formData, "provider"),
      providerTransactionId: stringValue(formData, "providerTransactionId"),
      receivedAt: stringValue(formData, "receivedAt"),
      payerName: stringValue(formData, "payerName"),
      payerPhone: stringValue(formData, "payerPhone"),
      narration: stringValue(formData, "narration"),
      bankCode: stringValue(formData, "bankCode"),
    });
    if (!parsed.ok) return parsed.state;

    const paymentId = await recordManualReceipt(user, parsed.data);
    revalidatePaymentSurfaces(paymentId, parsed.data.tenantId);
    return formSuccess("Receipt recorded and allocated.", paymentId);
  } catch (error) {
    return toFormState(error);
  }
}

export async function reversePaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "approve_reversals");
    const paymentId = requiredId(formData, "paymentId", "payment reference");

    const parsed = parseFormValues(paymentReverseSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    const reversalId = await reversePayment(user, paymentId, parsed.data.reason);
    revalidatePaymentSurfaces(paymentId);
    revalidatePath(`/payments/${reversalId}`);
    return formSuccess("Payment reversed with a compensating entry.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function resolveUnmatchedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "reconcile_payments");
    const unmatchedId = requiredId(
      formData,
      "unmatchedId",
      "unmatched payment reference",
    );

    const parsed = parseFormValues(unmatchedResolveSchema, {
      tenantId: stringValue(formData, "tenantId"),
      note: stringValue(formData, "note"),
    });
    if (!parsed.ok) return parsed.state;

    const paymentId = await resolveUnmatched(user, unmatchedId, parsed.data);
    revalidatePaymentSurfaces(paymentId, parsed.data.tenantId);
    return formSuccess("Payment matched and allocated.", paymentId);
  } catch (error) {
    return toFormState(error);
  }
}

export async function ignoreUnmatchedAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "reconcile_payments");
    const unmatchedId = requiredId(
      formData,
      "unmatchedId",
      "unmatched payment reference",
    );

    const parsed = parseFormValues(unmatchedIgnoreSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await ignoreUnmatched(user, unmatchedId, parsed.data);
    revalidatePaymentSurfaces();
    return formSuccess("Payment left in the queue and marked ignored.");
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * Send an M-Pesa STK prompt. Nothing is recorded until the receipt callback
 * from Daraja confirms the money actually moved — the prompt itself is only a
 * collect request, which is why it is deliberately cheaper to send than a
 * recorded receipt.
 */
export async function requestStkPushAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "reconcile_payments");

    const parsed = parseFormValues(stkPushRequestSchema, {
      tenantId: stringValue(formData, "tenantId"),
      amount: stringValue(formData, "amount"),
      overridePhone: stringValue(formData, "overridePhone"),
      note: stringValue(formData, "note"),
    });
    if (!parsed.ok) return parsed.state;

    const tenant = await getTenant(user, parsed.data.tenantId);
    if (tenant.status !== "active") {
      throw new ServiceError(
        "validation",
        "Payment prompts can only be sent to active tenants.",
      );
    }

    const phoneE164 = parsed.data.overridePhone || tenant.phoneE164;
    if (!phoneE164) {
      throw new ServiceError(
        "validation",
        "This tenant has no phone number on file. Enter the phone to bill.",
        {
          fieldErrors: {
            overridePhone: ["Enter the phone number to bill."],
          },
        },
      );
    }

    const accountId = tenant.currentUnitId ?? tenant.id;

    const prompt = await initiateStkPush(user, {
      phoneE164,
      amountMinor: parsed.data.amount,
      tenantId: tenant.id,
      accountId,
      note: parsed.data.note,
    });

    revalidatePaymentSurfaces();
    return formSuccess(
      `M-Pesa prompt sent to ${phoneE164} (${prompt.checkoutRequestId}). It completes in under a minute, or when the customer enters their PIN.`,
    );
  } catch (error) {
    return toFormState(error);
  }
}
