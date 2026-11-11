"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Pencil,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IDLE_FORM_STATE } from "@/lib/errors";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/types";
import type { PropertyOption, StaffListItem } from "@/lib/types/views";
import {
  inviteStaffAction,
  setStaffActiveAction,
  updateStaffRoleScopeAction,
} from "@/app/(dashboard)/settings/actions";

function PropertyPicker({
  propertyOptions,
  defaultIds,
  error,
}: {
  propertyOptions: PropertyOption[];
  defaultIds?: string[];
  error?: string[];
}) {
  return (
    <Field
      label="Properties"
      error={error}
      hint="Decides what this person can see and manage."
    >
      <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
        {propertyOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active properties available.
          </p>
        ) : (
          propertyOptions.map((property) => (
            <label key={property.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="propertyIds"
                value={property.id}
                defaultChecked={defaultIds?.includes(property.id)}
                className="size-3.5 rounded border-input accent-primary"
              />
              <span>{property.name}</span>
            </label>
          ))
        )}
      </div>
    </Field>
  );
}

/**
 * The invite form. On success the action returns the generated password in
 * `state.secret` — the dialog then stays open with a one-time result view
 * instead of closing, and the password is never toasted.
 */
function InviteStaffForm({
  propertyOptions,
  onDone,
}: {
  propertyOptions: PropertyOption[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(inviteStaffAction, IDLE_FORM_STATE);
  const [role, setRole] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.status !== "success") return;
    if (state.secret) return;
    toast.success(state.message ?? "Saved");
    onDone();
  }, [state, onDone]);

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      return;
    } catch {
      // Fall through to the legacy path for non-secure contexts.
    }

    try {
      const area = document.createElement("textarea");
      area.value = secret;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      setCopied(true);
    } catch {
      toast.error("Copy failed — select the password and copy it manually.");
    }
  }

  if (state.status === "success" && state.secret) {
    const secret = state.secret;
    return (
      <div className="space-y-4">
        <FormAlert state={state} />

        <div className="space-y-1.5">
          <p className="text-sm font-medium">One-time password</p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
            <code className="flex-1 break-all font-mono text-sm">{secret}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copySecret(secret)}
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This password is shown only once — ask the staff member to change
            it on /account.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          htmlFor="fullName"
          required
          error={state.fieldErrors?.fullName}
        >
          <Input
            id="fullName"
            name="fullName"
            required
            maxLength={120}
            placeholder="Jane Wanjiru"
          />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          required
          error={state.fieldErrors?.email}
        >
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            placeholder="jane@example.com"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Role"
          htmlFor="role"
          required
          error={state.fieldErrors?.role}
        >
          <NativeSelect
            id="role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            required
          >
            <option value="" disabled>
              Choose a role
            </option>
            {ROLES.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {ROLE_LABELS[roleOption]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Phone (optional)"
          htmlFor="phoneE164"
          error={state.fieldErrors?.phoneE164}
          hint="Kenyan mobile, used for reminders."
        >
          <Input
            id="phoneE164"
            name="phoneE164"
            maxLength={200}
            placeholder="0712 345 678"
          />
        </Field>
      </div>

      {role === "admin" ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Administrators see every property.
        </p>
      ) : (
        <PropertyPicker
          propertyOptions={propertyOptions}
          error={state.fieldErrors?.propertyIds}
        />
      )}

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Creating…">
          Create staff account
        </SubmitButton>
      </div>
    </form>
  );
}

export function InviteStaffDialog({
  propertyOptions,
}: {
  propertyOptions: PropertyOption[];
}) {
  const [open, setOpen] = useState(false);
  const [formId, setFormId] = useState(0);
  const router = useRouter();

  const handleDone = useCallback(() => {
    setOpen(false);
    // Remount the form so the one-time password view is cleared.
    setFormId((id) => id + 1);
    router.refresh();
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" />
          Invite staff
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite staff</DialogTitle>
          <DialogDescription>
            Creates their account with a one-time password you share with them
            once.
          </DialogDescription>
        </DialogHeader>
        <InviteStaffForm
          key={formId}
          propertyOptions={propertyOptions}
          onDone={handleDone}
        />
      </DialogContent>
    </Dialog>
  );
}

function StaffAccessForm({
  staff,
  propertyOptions,
  onSaved,
}: {
  staff: StaffListItem;
  propertyOptions: PropertyOption[];
  onSaved: () => void;
}) {
  const [state, formAction] = useActionState(
    updateStaffRoleScopeAction,
    IDLE_FORM_STATE,
  );
  const [role, setRole] = useState<Role>(staff.role);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    toast.success(state.message ?? "Saved");
    onSaved();
    router.refresh();
  }, [state, onSaved, router]);

  const roleSelectId = `staff-role-${staff.uid}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="uid" value={staff.uid} />
      <FormAlert state={state} />

      <Field
        label="Role"
        htmlFor={roleSelectId}
        required
        error={state.fieldErrors?.role}
      >
        <NativeSelect
          id={roleSelectId}
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          required
        >
          {ROLES.map((roleOption) => (
            <option key={roleOption} value={roleOption}>
              {ROLE_LABELS[roleOption]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {role === "admin" ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Administrators see every property.
        </p>
      ) : (
        <PropertyPicker
          propertyOptions={propertyOptions}
          defaultIds={staff.propertyIds}
          error={state.fieldErrors?.propertyIds}
        />
      )}

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Saving…">Save access</SubmitButton>
      </div>
    </form>
  );
}

export function EditStaffDialog({
  staff,
  propertyOptions,
}: {
  staff: StaffListItem;
  propertyOptions: PropertyOption[];
}) {
  const [open, setOpen] = useState(false);
  const handleSaved = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {staff.fullName}</DialogTitle>
          <DialogDescription>
            Access changes are audited. Deactivated staff must be reactivated
            first.
          </DialogDescription>
        </DialogHeader>
        <StaffAccessForm
          staff={staff}
          propertyOptions={propertyOptions}
          onSaved={handleSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DeactivateStaffButton({ staff }: { staff: StaffListItem }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <UserRoundX className="size-4" />
          Deactivate
        </Button>
      }
      title={`Deactivate ${staff.fullName}?`}
      description={
        <>
          Their sessions stop working immediately and they disappear from staff
          pickers. History and audit entries are kept, and they can be
          reactivated later.
        </>
      }
      confirmLabel="Deactivate"
      action={setStaffActiveAction}
      hiddenFields={{ uid: staff.uid }}
      requireReason
      reasonLabel="Reason for deactivating"
    />
  );
}

export function ReactivateStaffButton({ staff }: { staff: StaffListItem }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <UserRoundCheck className="size-4" />
          Reactivate
        </Button>
      }
      title={`Reactivate ${staff.fullName}?`}
      description="They can sign in again straight away with their existing role and property scope."
      confirmLabel="Reactivate"
      action={setStaffActiveAction}
      hiddenFields={{ uid: staff.uid, active: "true" }}
      requireReason
      reasonLabel="Reason for reactivating"
      destructive={false}
    />
  );
}
