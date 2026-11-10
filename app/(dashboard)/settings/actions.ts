"use server";

import { revalidatePath } from "next/cache";

import { assertCapability } from "@/lib/auth/scope";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { formSuccess, ServiceError, toFormState, type FormState } from "@/lib/errors";
import {
  checkboxValue,
  parseFormValues,
  stringArrayValue,
  stringValue,
} from "@/lib/validation/form";
import {
  billingRulesSchema,
  reminderRulesSchema,
  smsTemplateSchema,
  staffInviteSchema,
  staffRoleScopeSchema,
} from "@/lib/validation/settings";
import {
  updateBillingRules,
  updateReminderRules,
  updateSmsTemplates,
} from "@/services/settings";
import {
  inviteStaff,
  setStaffActive,
  updateStaffRoleScope,
} from "@/services/staff-admin";

async function actor(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ServiceError("unauthenticated", "Your session expired. Sign in again.");
  }
  return user;
}

function readBillingValues(formData: FormData) {
  return {
    allocationStrategy: stringValue(formData, "allocationStrategy"),
    overpayment: stringValue(formData, "overpayment"),
    lateFeeEnabled: checkboxValue(formData, "lateFeeEnabled"),
    lateFeeAmount: stringValue(formData, "lateFeeAmount") || "0",
    gracePeriodDays: stringValue(formData, "gracePeriodDays"),
    invoiceGenerationDay: stringValue(formData, "invoiceGenerationDay"),
  };
}

export async function updateBillingRulesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    assertCapability(user, "manage_settings");

    const parsed = parseFormValues(billingRulesSchema, readBillingValues(formData));
    if (!parsed.ok) return parsed.state;

    await updateBillingRules(user, parsed.data);
    revalidatePath("/settings");
    return formSuccess("Billing rules saved.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateReminderRulesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    assertCapability(user, "manage_settings");

    const parsed = parseFormValues(reminderRulesSchema, {
      dueSoonDaysBefore: stringValue(formData, "dueSoonDaysBefore"),
      overdueRepeatDays: stringValue(formData, "overdueRepeatDays"),
    });
    if (!parsed.ok) return parsed.state;

    await updateReminderRules(user, parsed.data);
    revalidatePath("/settings");
    return formSuccess("Reminder windows saved.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateSmsTemplatesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    assertCapability(user, "manage_settings");

    const parsed = parseFormValues(
      smsTemplatesSchema,
      readTemplatesValue(formData),
    );
    if (!parsed.ok) return parsed.state;

    await updateSmsTemplates(user, parsed.data);
    revalidatePath("/settings");
    return formSuccess("SMS templates saved.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function inviteStaffAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    assertCapability(user, "manage_staff");

    const parsed = parseFormValues(staffInviteSchema, {
      fullName: stringValue(formData, "fullName"),
      email: stringValue(formData, "email"),
      role: stringValue(formData, "role"),
      phoneE164: stringValue(formData, "phoneE164") || undefined,
      propertyIds: stringArrayValue(formData, "propertyIds"),
    });
    if (!parsed.ok) return parsed.state;

    const result = await inviteStaff(user, parsed.data);
    revalidatePath("/settings");
    return {
      status: "success",
      message: `${parsed.data.fullName} was invited. Share the password once,`
        + ` then they change it on /account.`,
      entityId: result.uid,
    };
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateStaffRoleScopeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    const uid = stringValue(formData, "uid");
    if (!uid) {
      throw new ServiceError("validation", "Missing staff reference.");
    }

    const parsed = parseFormValues(staffRoleScopeSchema, {
      role: stringValue(formData, "role"),
      propertyIds: stringArrayValue(formData, "propertyIds"),
    });
    if (!parsed.ok) return parsed.state;

    await updateStaffRoleScope(user, uid, parsed.data);
    revalidatePath("/settings");
    return formSuccess("Staff access saved.");
  } catch (error) {
    return toFormState(error);
  }
}

export async function setStaffActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await actor();
    const uid = stringValue(formData, "uid");
    const active = checkboxValue(formData, "active");
    const parsed = parseFormValues(
      reasonSchema,
      { reason: stringValue(formData, "reason") },
    );
    if (!parsed.ok) return parsed.state;

    await setStaffActive(user, uid, active, parsed.data.reason);
    revalidatePath("/settings");
    return formSuccess(active ? "Staff member reactivated." : "Staff member deactivated.");
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * The SmsTemplate[] arrives as parallel form fields:
 * `key`, `body` and `enabled` repeat once per editable template. Repeated
 * FormData names become arrays via `stringArrayValue`, so schema shape matches
 * the parsed values.
 */
function readTemplatesValue(formData: FormData) {
  const keys = stringArrayValue(formData, "key");
  const bodies = formData.getAll("body").map(String);
  const enabled = formData.getAll("enabled").map(String);

  return keys.map((key, index) => ({
    key,
    body: bodies[index] ?? "",
    enabled: enabled[index] === "on" || enabled[index] === "true",
  }));
}

import { z } from "zod";

const reasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { message: "Give a short reason (at least 5 characters)." })
    .max(500),
});
