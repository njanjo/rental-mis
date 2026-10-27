/**
 * Error and form-state contracts shared by services, server actions and forms.
 *
 * Services throw `ServiceError`; server actions convert whatever they catch into
 * a `FormState` the form can render. Keep messages safe for end users — never
 * leak Firestore internals, stack traces or other tenants' data.
 */

export const SERVICE_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "validation",
  "internal",
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: ServiceErrorCode,
    message: string,
    options?: { fieldErrors?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ServiceError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/** Shape returned by every server action and consumed by `useActionState`. */
export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set on success when the action creates or renames something. */
  entityId?: string;
}

export const IDLE_FORM_STATE: FormState = { status: "idle" };

export function formSuccess(message?: string, entityId?: string): FormState {
  return { status: "success", message, entityId };
}

export function formError(
  message: string,
  fieldErrors?: Record<string, string[]>,
): FormState {
  return { status: "error", message, fieldErrors };
}

/** Convert an unknown thrown value into a safe form error. */
export function toFormState(error: unknown): FormState {
  if (isServiceError(error)) {
    if (error.code === "validation") {
      return formError(error.message, error.fieldErrors);
    }
    return formError(error.message);
  }

  console.error("[action] unexpected failure", error);
  return formError("Something went wrong. Please try again.");
}
