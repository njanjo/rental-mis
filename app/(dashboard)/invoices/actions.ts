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
  invoiceGenerateSchema,
  invoiceVoidSchema,
} from "@/lib/validation/invoice";
import { generateInvoices, voidInvoice } from "@/services/invoices";

function revalidateInvoiceSurfaces(invoiceId?: string): void {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

export async function generateInvoicesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_invoices");

    const parsed = parseFormValues(invoiceGenerateSchema, {
      period: stringValue(formData, "period"),
    });
    if (!parsed.ok) return parsed.state;

    const result = await generateInvoices(user, parsed.data);
    revalidateInvoiceSurfaces();

    const message =
      result.created === 0
        ? `No new invoices for ${result.periodKey}. ${result.total} already existed.`
        : `${result.created} invoice${result.created === 1 ? "" : "s"} created for ${result.periodKey}` +
          (result.skipped > 0 ? `, ${result.skipped} already existed.` : ".");

    return formSuccess(message);
  } catch (error) {
    return toFormState(error);
  }
}

export async function voidInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_invoices");

    const invoiceId = stringValue(formData, "invoiceId");
    if (!invoiceId) {
      throw new ServiceError("validation", "Missing invoice reference.");
    }

    const parsed = parseFormValues(invoiceVoidSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await voidInvoice(user, invoiceId, parsed.data.reason);
    revalidateInvoiceSurfaces(invoiceId);
    return formSuccess("Invoice voided.");
  } catch (error) {
    return toFormState(error);
  }
}
