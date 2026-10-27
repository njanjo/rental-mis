import { z } from "zod";

import type { FormState } from "@/lib/errors";

/**
 * Bridge between native `<form>` submissions and zod schemas.
 *
 * `FormData` is flattened to a plain object first: checkboxes become booleans,
 * everything else stays a string, and repeated names become arrays.
 */
export type FormValues = Record<string, string | string[]>;

/** Server actions receive `FormData`; tests usually pass a plain object. */
export type FormSource = FormData | FormValues;

export function formDataToValues(formData: FormData): FormValues {
  const values: FormValues = {};

  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;

    const existing = values[key];
    if (existing === undefined) {
      values[key] = raw;
    } else if (Array.isArray(existing)) {
      existing.push(raw);
    } else {
      values[key] = [existing, raw];
    }
  }

  return values;
}

function asValues(source: FormSource): FormValues {
  return source instanceof FormData ? formDataToValues(source) : source;
}

/**
 * Read a checkbox as a boolean. Hidden inputs are not needed: an unchecked box
 * simply never appears in FormData.
 */
export function checkboxValue(source: FormSource, key: string): boolean {
  const value = asValues(source)[key];
  if (Array.isArray(value)) return value.length > 0;
  return value === "on" || value === "true" || value === "1";
}

export function stringValue(source: FormSource, key: string): string {
  const value = asValues(source)[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function stringArrayValue(source: FormSource, key: string): string[] {
  const value = asValues(source)[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

/** zod's flattened error map, normalised for `FormState`. */
export function fieldErrorsFrom(
  error: { fieldErrors: Record<string, string[] | undefined> },
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    if (messages && messages.length > 0) result[field] = messages;
  }
  return result;
}

export type ParseValuesResult<T> =
  | { ok: true; data: T }
  | { ok: false; state: FormState };

/** Validate form values and produce a ready-to-return `FormState` on failure. */
export function parseFormValues<T>(
  schema: z.ZodType<T>,
  values: unknown,
  fallbackMessage = "Please fix the highlighted fields.",
): ParseValuesResult<T> {
  const parsed = schema.safeParse(
    values instanceof FormData ? formDataToValues(values) : values,
  );
  if (parsed.success) return { ok: true, data: parsed.data };

  return {
    ok: false,
    state: {
      status: "error",
      message: fallbackMessage,
      fieldErrors: fieldErrorsFrom(z.flattenError(parsed.error)),
    },
  };
}
