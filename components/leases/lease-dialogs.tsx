"use client";

import { useState } from "react";
import { CalendarCheck, FileSignature, Pencil, Plus, XCircle } from "lucide-react";

import {
  LeaseForm,
  LeaseRenewForm,
  LeaseTermsForm,
} from "@/components/leases/lease-forms";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addMonths, toDateInput } from "@/lib/dates";
import type { FormState } from "@/lib/errors";
import type { LeaseDetail, TenantOption, UnitOption } from "@/lib/types/views";
import {
  activateLeaseAction,
  createLeaseAction,
  renewLeaseAction,
  terminateLeaseAction,
  updateLeaseTermsAction,
} from "@/app/(dashboard)/leases/actions";

export function CreateLeaseDialog({
  tenantOptions,
  unitOptions,
  disabled,
}: {
  tenantOptions: TenantOption[];
  unitOptions: UnitOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="size-4" />
          New lease
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lease</DialogTitle>
          <DialogDescription>
            The lease starts as pending. Activate it on the move-in date to
            occupy the unit.
          </DialogDescription>
        </DialogHeader>
        <LeaseForm
          action={createLeaseAction}
          tenantOptions={tenantOptions}
          unitOptions={unitOptions}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditLeaseTermsDialog({ lease }: { lease: LeaseDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-4" />
          Edit terms
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit lease terms</DialogTitle>
          <DialogDescription>
            Dates, the tenant and the unit stay fixed. To move a tenancy, start a
            new lease.
          </DialogDescription>
        </DialogHeader>
        <LeaseTermsForm
          action={updateLeaseTermsAction}
          leaseId={lease.id}
          mode={lease.status === "active" ? "active" : "pending"}
          defaultValues={{
            rentAmount: lease.rentAmountMinor,
            depositAmount: lease.depositAmountMinor,
            dueDay: lease.dueDay,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RenewLeaseDialog({ lease }: { lease: LeaseDetail }) {
  const [open, setOpen] = useState(false);
  const currentEnd = lease.endDate ? new Date(lease.endDate) : new Date();
  const nextEnd = addMonths(currentEnd, 12);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSignature className="size-4" />
          Renew
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Renew lease</DialogTitle>
          <DialogDescription>
            Creates a pending renewal linked to this lease. The deposit carries
            over; activating the renewal expires this lease.
          </DialogDescription>
        </DialogHeader>
        <LeaseRenewForm
          action={renewLeaseAction}
          leaseId={lease.id}
          defaultValues={{
            startDate: toDateInput(currentEnd),
            endDate: toDateInput(nextEnd),
            rentAmount: lease.rentAmountMinor,
            dueDay: lease.dueDay,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ActivateLeaseButton({ lease }: { lease: LeaseDetail }) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm">
          <CalendarCheck className="size-4" />
          Activate
        </Button>
      }
      title="Activate this lease?"
      description={
        <>
          The unit becomes occupied and the tenant becomes its current occupant.
          Any renewal source lease is expired at the same time.
        </>
      }
      confirmLabel="Activate lease"
      action={activateLeaseAction}
      hiddenFields={{ leaseId: lease.id }}
      destructive={false}
    />
  );
}

export function TerminateLeaseButton({
  lease,
  action = terminateLeaseAction,
}: {
  lease: LeaseDetail;
  action?: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <XCircle className="size-4" />
          {lease.status === "pending" ? "Cancel" : "Terminate"}
        </Button>
      }
      title={
        lease.status === "pending"
          ? "Cancel this pending lease?"
          : "Terminate this lease?"
      }
      description={
        lease.status === "pending"
          ? "The draft lease is cancelled and disappears from open tenancies. The tenant and unit are unchanged."
          : "The unit becomes vacant and the tenant's current tenancy is cleared. Payment and invoice history is kept."
      }
      confirmLabel={lease.status === "pending" ? "Cancel lease" : "Terminate lease"}
      action={action}
      hiddenFields={{ leaseId: lease.id }}
      requireReason
      reasonLabel={
        lease.status === "pending" ? "Reason for cancelling" : "Reason for termination"
      }
    />
  );
}
