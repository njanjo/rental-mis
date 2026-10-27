"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/require";
import { assertCapability } from "@/lib/auth/scope";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import {
  checkboxValue,
  parseFormValues,
  stringValue,
} from "@/lib/validation/form";
import {
  tenantCreateSchema,
  tenantStatusSchema,
  tenantUpdateSchema,
} from "@/lib/validation/tenant";
import {
  createTenant,
  setTenantStatus,
  updateTenant,
} from "@/services/tenants";

function readTenantValues(formData: FormData, includeProperty: boolean) {
  return {
    ...(includeProperty ? { propertyId: stringValue(formData, "propertyId") } : {}),
    fullName: stringValue(formData, "fullName"),
    phone: stringValue(formData, "phone"),
    nationalIdLast4: stringValue(formData, "nationalIdLast4"),
    consentSms: checkboxValue(formData, "consentSms"),
    notes: stringValue(formData, "notes"),
  };
}

export async function createTenantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    assertCapability(user, "manage_tenants");

    const parsed = parseFormValues(
      tenantCreateSchema,
      readTenantValues(formData, true),
    );
    if (!parsed.ok) return parsed.state;

    const id = await createTenant(user, parsed.data);
    revalidatePath("/tenants");
    revalidatePath("/properties");
    revalidatePath(`/properties/${parsed.data.propertyId}`);
    return formSuccess("Tenant created.", id);
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateTenantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const tenantId = stringValue(formData, "tenantId");
    if (!tenantId) {
      throw new ServiceError("validation", "Missing tenant reference.");
    }

    const parsed = parseFormValues(
      tenantUpdateSchema,
      readTenantValues(formData, false),
    );
    if (!parsed.ok) return parsed.state;

    await updateTenant(user, tenantId, parsed.data);
    revalidatePath("/tenants");
    revalidatePath(`/tenants/${tenantId}`);
    return formSuccess("Tenant updated.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function setTenantStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireSessionUser();
    const tenantId = stringValue(formData, "tenantId");
    if (!tenantId) {
      throw new ServiceError("validation", "Missing tenant reference.");
    }

    const parsed = parseFormValues(tenantStatusSchema, {
      status: stringValue(formData, "status"),
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await setTenantStatus(user, tenantId, parsed.data.status, parsed.data.reason);
    revalidatePath("/tenants");
    revalidatePath(`/tenants/${tenantId}`);
    return formSuccess("Tenant status updated.");
  } catch (error) {
    return toFormState(error);
  }
}
