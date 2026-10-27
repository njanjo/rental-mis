"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import { parseFormValues, stringValue } from "@/lib/validation/form";
import {
  leaseCreateSchema,
  leaseRenewSchema,
  leaseTerminateSchema,
  leaseTermsSchema,
} from "@/lib/validation/lease";
import {
  activateLease,
  createLease,
  renewLease,
  terminateLease,
  updateLeaseTerms,
} from "@/services/leases";

function leaseIdFrom(formData: FormData): string {
  const leaseId = stringValue(formData, "leaseId");
  if (!leaseId) {
    throw new ServiceError("validation", "Missing lease reference.");
  }
  return leaseId;
}

function termValues(formData: FormData) {
  return {
    rentAmount: stringValue(formData, "rentAmount"),
    depositAmount: stringValue(formData, "depositAmount"),
    dueDay: stringValue(formData, "dueDay"),
  };
}

function revalidateLeaseSurfaces(leaseId?: string): void {
  revalidatePath("/leases");
  revalidatePath("/units");
  revalidatePath("/tenants");
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  if (leaseId) revalidatePath(`/leases/${leaseId}`);
}

export async function createLeaseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_leases");

    const parsed = parseFormValues(leaseCreateSchema, {
      tenantId: stringValue(formData, "tenantId"),
      unitId: stringValue(formData, "unitId"),
      startDate: stringValue(formData, "startDate"),
      endDate: stringValue(formData, "endDate"),
      rentAmount: stringValue(formData, "rentAmount"),
      depositAmount: stringValue(formData, "depositAmount"),
      dueDay: stringValue(formData, "dueDay"),
    });
    if (!parsed.ok) return parsed.state;

    const id = await createLease(user, parsed.data);
    revalidateLeaseSurfaces(id);
    return formSuccess("Lease created. Activate it when the tenant moves in.", id);
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateLeaseTermsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const leaseId = leaseIdFrom(formData);

    const parsed = parseFormValues(leaseTermsSchema, {
      ...termValues(formData),
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await updateLeaseTerms(user, leaseId, parsed.data);
    revalidateLeaseSurfaces(leaseId);
    return formSuccess("Lease terms updated.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function activateLeaseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const leaseId = leaseIdFrom(formData);

    await activateLease(user, leaseId);
    revalidateLeaseSurfaces(leaseId);
    return formSuccess("Lease activated and the unit marked occupied.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function terminateLeaseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const leaseId = leaseIdFrom(formData);
    const endDate = stringValue(formData, "endDate").trim();

    const parsed = parseFormValues(leaseTerminateSchema, {
      reason: stringValue(formData, "reason"),
      endDate: endDate || undefined,
    });
    if (!parsed.ok) return parsed.state;

    await terminateLease(user, leaseId, parsed.data);
    revalidateLeaseSurfaces(leaseId);
    return formSuccess("Lease terminated.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function renewLeaseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const leaseId = leaseIdFrom(formData);

    const parsed = parseFormValues(leaseRenewSchema, {
      startDate: stringValue(formData, "startDate"),
      endDate: stringValue(formData, "endDate"),
      rentAmount: stringValue(formData, "rentAmount"),
      dueDay: stringValue(formData, "dueDay"),
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    const id = await renewLease(user, leaseId, parsed.data);
    revalidateLeaseSurfaces(leaseId);
    revalidatePath(`/leases/${id}`);
    return formSuccess("Renewal drafted. Activate it when the new term starts.", id);
  } catch (error) {
    return toFormState(error);
  }
}
