"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import { formSuccess, ServiceError, toFormState } from "@/lib/errors";
import type { BankImportFormState } from "@/lib/types/views";
import {
  bankColumnMappingSchema,
  bankImportSchema,
  type BankImportInput,
} from "@/lib/validation/bank-import";
import { parseFormValues, stringValue } from "@/lib/validation/form";
import {
  commitBankStatement,
  previewBankStatement,
} from "@/services/bank-import";

function readMapping(raw: string): BankImportInput["mapping"] {
  if (!raw.trim()) return undefined;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ServiceError(
      "validation",
      "The column mapping is not readable. Refresh the preview and try again.",
    );
  }

  const parsed = bankColumnMappingSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ServiceError(
      "validation",
      "The column mapping is not valid. Refresh the preview and try again.",
    );
  }

  return parsed.data;
}

function readInput(formData: FormData): BankImportInput {
  const parsed = parseFormValues(bankImportSchema, {
    bankCode: stringValue(formData, "bankCode"),
    fileName: stringValue(formData, "fileName"),
    csv: stringValue(formData, "csv"),
    dateFormat: stringValue(formData, "dateFormat") || "auto",
    mapping: readMapping(stringValue(formData, "mapping")),
  });

  if (!parsed.ok) {
    throw new ServiceError(
      "validation",
      parsed.state.message ?? "Fix the import form.",
      { fieldErrors: parsed.state.fieldErrors },
    );
  }
  return parsed.data;
}

function revalidateImportSurfaces(): void {
  revalidatePath("/payments");
  revalidatePath("/payments/import");
  revalidatePath("/payments/unmatched");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

export async function previewBankStatementAction(
  _previous: BankImportFormState,
  formData: FormData,
): Promise<BankImportFormState> {
  try {
    const user = await requireSessionUser();
    const input = readInput(formData);
    const preview = await previewBankStatement(user, input);
    return { status: "success", preview };
  } catch (error) {
    return toFormState(error) as BankImportFormState;
  }
}

export async function commitBankStatementAction(
  _previous: BankImportFormState,
  formData: FormData,
): Promise<BankImportFormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "enter_manual_receipts");
    assertCapability(user, "reconcile_payments");

    const input = readInput(formData);
    const result = await commitBankStatement(user, input);
    revalidateImportSurfaces();

    return {
      ...formSuccess(
        `Imported ${result.imported} ${result.imported === 1 ? "receipt" : "receipts"}${
          result.queued > 0
            ? `, queued ${result.queued} for review`
            : ""
        }.`,
      ),
      result,
    };
  } catch (error) {
    return toFormState(error) as BankImportFormState;
  }
}
