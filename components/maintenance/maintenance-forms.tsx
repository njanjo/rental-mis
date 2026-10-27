"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, type FormState } from "@/lib/errors";
import {
  MAINTENANCE_PRIORITIES,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/lib/types";
import type {
  MaintenanceDetail,
  PropertyOption,
  StaffOption,
  UnitOption,
} from "@/lib/types/views";
import {
  MAINTENANCE_TRANSITIONS,
} from "@/lib/validation/maintenance";

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function eligibleAssignees(
  staff: StaffOption[],
  propertyId: string,
): StaffOption[] {
  if (!propertyId) return staff;
  return staff.filter(
    (person) =>
      person.role === "admin" || person.propertyIds.includes(propertyId),
  );
}

export function MaintenanceCreateForm({
  action,
  propertyOptions,
  unitOptions,
  staffOptions,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  propertyOptions: PropertyOption[];
  unitOptions: UnitOption[];
  staffOptions: StaffOption[];
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();
  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    if (state.entityId) {
      router.push(`/maintenance/${state.entityId}`);
      router.refresh();
    }
  }, [state, router]);

  const propertyUnits = unitOptions.filter(
    (unit) => unit.propertyId === propertyId,
  );
  const assignees = eligibleAssignees(staffOptions, propertyId);

  function selectProperty(nextPropertyId: string) {
    setPropertyId(nextPropertyId);
    setUnitId("");
    const nextAssignees = eligibleAssignees(staffOptions, nextPropertyId);
    if (!nextAssignees.some((person) => person.uid === assignedTo)) {
      setAssignedTo("");
    }
  }

  if (propertyOptions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        You need access to a property before logging maintenance.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Property"
          htmlFor="propertyId"
          required
          error={state.fieldErrors?.propertyId}
        >
          <NativeSelect
            id="propertyId"
            name="propertyId"
            value={propertyId}
            onChange={(event) => selectProperty(event.target.value)}
            required
          >
            <option value="" disabled>
              Choose a property
            </option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Unit"
          htmlFor="unitId"
          required
          error={state.fieldErrors?.unitId}
        >
          <NativeSelect
            id="unitId"
            name="unitId"
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={!propertyId}
            required
          >
            <option value="" disabled>
              {propertyId ? "Choose a unit" : "Choose a property first"}
            </option>
            {propertyUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.unitNumber}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="Title"
        htmlFor="title"
        required
        error={state.fieldErrors?.title}
      >
        <Input
          id="title"
          name="title"
          placeholder="Leaking kitchen sink"
          maxLength={120}
          required
        />
      </Field>

      <Field
        label="What is the issue?"
        htmlFor="issue"
        required
        error={state.fieldErrors?.issue}
      >
        <Textarea
          id="issue"
          name="issue"
          rows={4}
          placeholder="Describe the problem and anything the caretaker should know."
          maxLength={2000}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Priority"
          htmlFor="priority"
          required
          error={state.fieldErrors?.priority}
        >
          <NativeSelect id="priority" name="priority" defaultValue="medium" required>
            {MAINTENANCE_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Assign to"
          htmlFor="assignedTo"
          error={state.fieldErrors?.assignedTo}
          hint="Optional. Assigning now sets the request to Assigned."
        >
          <NativeSelect
            id="assignedTo"
            name="assignedTo"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            disabled={!propertyId}
          >
            <option value="">Unassigned</option>
            {assignees.map((person) => (
              <option key={person.uid} value={person.uid}>
                {person.fullName}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Logging…">Log request</SubmitButton>
      </div>
    </form>
  );
}

export function MaintenanceUpdateForm({
  action,
  request,
  staffOptions,
  canAssign,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  request: MaintenanceDetail;
  staffOptions: StaffOption[];
  canAssign: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    router.refresh();
  }, [state, router]);

  const nextStatuses = [
    request.status,
    ...MAINTENANCE_TRANSITIONS[request.status],
  ];
  const noteRequired =
    nextStatuses.includes("resolved") || nextStatuses.includes("cancelled");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="requestId" value={request.id} />
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Status"
          htmlFor="status"
          required
          error={state.fieldErrors?.status}
        >
          <NativeSelect
            id="status"
            name="status"
            defaultValue={request.status}
            required
          >
            {nextStatuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Priority"
          htmlFor="priority"
          required
          error={state.fieldErrors?.priority}
        >
          <NativeSelect
            id="priority"
            name="priority"
            defaultValue={request.priority}
            required
          >
            {MAINTENANCE_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {canAssign ? (
        <Field
          label="Assigned to"
          htmlFor="assignedTo"
          error={state.fieldErrors?.assignedTo}
          hint="Assigned and In progress requests need an owner."
        >
          <NativeSelect
            id="assignedTo"
            name="assignedTo"
            defaultValue={request.assignedTo ?? ""}
          >
            <option value="">Unassigned</option>
            {staffOptions.map((person) => (
              <option key={person.uid} value={person.uid}>
                {person.fullName}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <input type="hidden" name="assignedTo" value={request.assignedTo ?? ""} />
      )}

      <Field
        label="Note"
        htmlFor="note"
        error={state.fieldErrors?.note}
        hint={
          noteRequired
            ? "Required when resolving or cancelling."
            : "Shared with the team and recorded in the audit log."
        }
      >
        <Textarea
          id="note"
          name="note"
          rows={3}
          placeholder="Progress, parts ordered, or what was fixed."
          maxLength={1000}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save update</SubmitButton>
      </div>
    </form>
  );
}
