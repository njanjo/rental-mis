"use client";

import { useState } from "react";
import { ArchiveRestore, Pencil, Plus } from "lucide-react";

import { UnitForm } from "@/components/units/unit-form";
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
import type { FormState } from "@/lib/errors";
import type { PropertyOption, UnitDetail } from "@/lib/types/views";
import { moneyInputValue } from "@/lib/validation/money";
import {
  archiveUnitAction,
  createUnitAction,
  restoreUnitAction,
  updateUnitAction,
} from "@/app/(dashboard)/units/actions";

export function CreateUnitDialog({
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
          New unit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New unit</DialogTitle>
          <DialogDescription>
            Rent entered here is the asking rent; the lease holds the agreed rent.
          </DialogDescription>
        </DialogHeader>
        <UnitForm
          action={createUnitAction}
          mode="create"
          propertyOptions={propertyOptions}
          defaultPropertyId={defaultPropertyId}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditUnitDialog({
  unit,
  isOccupied,
}: {
  unit: UnitDetail;
  isOccupied: boolean;
}) {
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
          <DialogTitle>Edit unit {unit.unitNumber}</DialogTitle>
          <DialogDescription>Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <UnitForm
          action={updateUnitAction}
          mode="edit"
          unitId={unit.id}
          propertyOptions={[]}
          isOccupied={isOccupied}
          defaultValues={{
            rentAmount: moneyInputValue(unit.rentAmountMinor),
            depositAmount: moneyInputValue(unit.depositAmountMinor),
            status: unit.status,
            notes: unit.notes ?? "",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveUnitButton({
  unit,
  action = archiveUnitAction,
  label,
}: {
  unit: UnitDetail;
  action?: (state: FormState, formData: FormData) => Promise<FormState>;
  label?: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <ArchiveRestore className="size-4" />
          {label ?? "Archive"}
        </Button>
      }
      title={`Archive unit ${unit.unitNumber}?`}
      description={
        <>
          The unit disappears from active lists but its lease history is kept.
          End or cancel any open leases first.
        </>
      }
      confirmLabel="Archive unit"
      action={action}
      hiddenFields={{ unitId: unit.id }}
      requireReason
      reasonLabel="Reason for archiving"
    />
  );
}

export function RestoreUnitButton({ unit }: { unit: UnitDetail }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <ArchiveRestore className="size-4" />
          Restore
        </Button>
      }
      title={`Restore unit ${unit.unitNumber}?`}
      description="The unit becomes available for new leases again."
      confirmLabel="Restore unit"
      action={restoreUnitAction}
      hiddenFields={{ unitId: unit.id }}
      requireReason
      reasonLabel="Reason for restoring"
      destructive={false}
    />
  );
}
