"use server";

import { revalidatePath } from "next/cache";

import { assertCapability } from "@/lib/auth/scope";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import {
  parseFormValues,
  stringArrayValue,
  stringValue,
} from "@/lib/validation/form";
import {
  propertyArchiveSchema,
  propertySchema,
} from "@/lib/validation/property";
import {
  archiveProperty,
  createProperty,
  restoreProperty,
  updateProperty,
} from "@/services/properties";

async function actor(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ServiceError("unauthenticated", "Your session expired. Sign in again.");
  }
  return user;
}

function readPropertyValues(formData: FormData) {
  return {
    name: stringValue(formData, "name"),
    address: stringValue(formData, "address"),
    county: stringValue(formData, "county"),
    managerIds: stringArrayValue(formData, "managerIds"),
    notes: stringValue(formData, "notes"),
  };
}

export async function createPropertyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    assertCapability(user, "manage_properties");

    const parsed = parseFormValues(propertySchema, readPropertyValues(formData));
    if (!parsed.ok) return parsed.state;

    const id = await createProperty(user, parsed.data);
    revalidatePath("/properties");
    return formSuccess("Property created.", id);
  } catch (error) {
    return toFormState(error);
  }
}

export async function updatePropertyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    const propertyId = stringValue(formData, "propertyId");
    if (!propertyId) {
      throw new ServiceError("validation", "Missing property reference.");
    }

    const parsed = parseFormValues(propertySchema, readPropertyValues(formData));
    if (!parsed.ok) return parsed.state;

    await updateProperty(user, propertyId, parsed.data);
    revalidatePath("/properties");
    revalidatePath(`/properties/${propertyId}`);
    return formSuccess("Property updated.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function archivePropertyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    const propertyId = stringValue(formData, "propertyId");
    const parsed = parseFormValues(propertyArchiveSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await archiveProperty(user, propertyId, parsed.data.reason);
    revalidatePath("/properties");
    revalidatePath(`/properties/${propertyId}`);
    return formSuccess("Property archived.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function restorePropertyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    const propertyId = stringValue(formData, "propertyId");
    const parsed = parseFormValues(propertyArchiveSchema, {
      reason: stringValue(formData, "reason"),
    });
    if (!parsed.ok) return parsed.state;

    await restoreProperty(user, propertyId, parsed.data.reason);
    revalidatePath("/properties");
    revalidatePath(`/properties/${propertyId}`);
    return formSuccess("Property restored.");
  } catch (error) {
    return toFormState(error);
  }
}
