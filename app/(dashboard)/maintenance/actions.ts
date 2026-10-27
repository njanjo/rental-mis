"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import { parseFormValues, stringValue } from "@/lib/validation/form";
import {
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from "@/lib/validation/maintenance";
import { createMaintenance, updateMaintenance } from "@/services/maintenance";

function requestIdFrom(formData: FormData): string {
  const requestId = stringValue(formData, "requestId");
  if (!requestId) {
    throw new ServiceError("validation", "Missing maintenance reference.");
  }
  return requestId;
}

function revalidateMaintenanceSurfaces(requestId?: string, unitId?: string): void {
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  if (requestId) revalidatePath(`/maintenance/${requestId}`);
  if (unitId) {
    revalidatePath(`/units/${unitId}`);
    revalidatePath("/units");
  }
}

export async function createMaintenanceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_maintenance");

    const parsed = parseFormValues(maintenanceCreateSchema, {
      propertyId: stringValue(formData, "propertyId"),
      unitId: stringValue(formData, "unitId"),
      title: stringValue(formData, "title"),
      issue: stringValue(formData, "issue"),
      priority: stringValue(formData, "priority"),
      assignedTo: stringValue(formData, "assignedTo"),
    });
    if (!parsed.ok) return parsed.state;

    const id = await createMaintenance(user, parsed.data);
    revalidateMaintenanceSurfaces(id, parsed.data.unitId);
    return formSuccess("Maintenance request logged.", id);
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateMaintenanceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "update_maintenance");
    const requestId = requestIdFrom(formData);

    const parsed = parseFormValues(maintenanceUpdateSchema, {
      status: stringValue(formData, "status"),
      priority: stringValue(formData, "priority"),
      assignedTo: stringValue(formData, "assignedTo"),
      note: stringValue(formData, "note"),
    });
    if (!parsed.ok) return parsed.state;

    await updateMaintenance(user, requestId, parsed.data);
    revalidateMaintenanceSurfaces(requestId);
    return formSuccess("Maintenance request updated.");
  } catch (error) {
    return toFormState(error);
  }
}
