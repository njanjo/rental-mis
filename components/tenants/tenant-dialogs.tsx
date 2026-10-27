"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { TenantForm } from "@/components/tenants/tenant-form";
import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, type FormState } from "@/lib/errors";
import { TENANT_STATUSES, type TenantStatus } from "@/lib/types";
import type { PropertyOption, TenantDetail } from "@/lib/types/views";
import {
  createTenantAction,
  setTenantStatusAction,
  updateTenantAction,
} from "@/app/(dashboard)/tenants/actions";

export function CreateTenantDialog({
  propertyOptions,
  defaultPropertyId,
  disabled,
}: {
  propertyOptions: PropertyOption[];
  defaultPropertyId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="size-4" />
          New tenant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            The phone number is unique among active tenants and is used to match
            M-Pesa payments.
          </DialogDescription>
        </DialogHeader>
        <TenantForm
          action={createTenantAction}
          mode="create"
          propertyOptions={propertyOptions}
          defaultPropertyId={defaultPropertyId}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditTenantDialog({ tenant }: { tenant: TenantDetail }) {
  const [open, setOpen] = useState(false);

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
          <DialogTitle>Edit {tenant.fullName}</DialogTitle>
          <DialogDescription>Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <TenantForm
          action={updateTenantAction}
          mode="edit"
          tenantId={tenant.id}
          propertyOptions={[]}
          defaultValues={{
            fullName: tenant.fullName,
            phone: tenant.phoneE164,
            nationalIdLast4: tenant.nationalIdLast4 ?? "",
            consentSms: tenant.consentSms,
            notes: tenant.notes ?? "",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  former: "Former",
};

/**
 * Status is not part of the edit form: moving a tenant to inactive/former can
 * strand an active lease, so it needs its own reason and its own checks.
 */
export function TenantStatusDialog({ tenant }: { tenant: TenantDetail }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    setTenantStatusAction,
    IDLE_FORM_STATE as FormState,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    setOpen(false);
    toast.success(state.message ?? "Status updated");
    router.refresh();
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserRoundCog className="size-4" />
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change tenant status</DialogTitle>
          <DialogDescription>
            A tenant with an active lease cannot be marked inactive or former.
            End the lease first.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <FormAlert state={state} />

          <Field
            label="Status"
            htmlFor="status"
            required
            error={state.fieldErrors?.status}
          >
            <NativeSelect id="status" name="status" defaultValue={tenant.status}>
              {TENANT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-status-reason">Reason</Label>
            <Textarea
              id="tenant-status-reason"
              name="reason"
              rows={3}
              placeholder="Why is the status changing?"
              required
              minLength={5}
              maxLength={500}
              disabled={pending}
            />
            {(state.fieldErrors?.reason ?? []).length > 0 ? (
              <p className="text-xs text-destructive">{state.fieldErrors?.reason?.[0]}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…">Save status</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
