"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import {
  parseFormValues,
  stringValue,
} from "@/lib/validation/form";
import { unitArchiveSchema, unitSchema, unitUpdateSchema } from "@/lib/validation/unit";
import {
  archiveUnit,
  createUnit,
  restoreUnit,
  updateUnit,
} from "@/services/units";

export async function createUnitAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_units");

    const parsed = parseFormValues(unitSchema, formData);
    if (!parsed.ok) return parsed.state;

    const id = await createUnit(user, parsed.data);
    revalidatePath("/units");
    revalidatePath("/properties");
    revalidatePath(`/properties/${parsed.data.propertyId}`);
    return formSuccess("Unit created.", id);
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateUnitAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const unitId = stringValue(formData, "unitId");
    if (!unitId) {
      throw new ServiceError("validation", "Missing unit reference.");
    }

    const parsed = parseFormValues(unitUpdateSchema, formData);
    if (!parsed.ok) return parsed.state;

    await updateUnit(user, unitId, parsed.data);
    revalidatePath("/units");
    revalidatePath(`/units/${unitId}`);
    revalidatePath("/properties");
    return formSuccess("Unit updated.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function archiveUnitAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const unitId = stringValue(formData, "unitId");
    if (!unitId) {
      throw new ServiceError("validation", "Missing unit reference.");
    }

    const parsed = parseFormValues(unitArchiveSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await archiveUnit(user, unitId, parsed.data.reason);
    revalidatePath("/units");
    revalidatePath(`/units/${unitId}`);
    revalidatePath("/properties");
    return formSuccess("Unit archived.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function restoreUnitAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const unitId = stringValue(formData, "unitId");
    if (!unitId) {
      throw new ServiceError("validation", "Missing unit reference.");
    }

    const parsed = parseFormValues(unitArchiveSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await restoreUnit(user, unitId, parsed.data.reason);
    revalidatePath("/units");
    revalidatePath(`/units/${unitId}`);
    revalidatePath("/properties");
    return formSuccess("Unit restored.");
  } catch (error) {
    return toFormState(error);
  }
}
