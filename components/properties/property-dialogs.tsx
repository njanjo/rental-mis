"use client";

import { useState } from "react";
import { ArchiveRestore, Pencil, Plus } from "lucide-react";

import { PropertyForm } from "@/components/properties/property-form";
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
import type { PropertyDetail, StaffOption } from "@/lib/types/views";
import {
  archivePropertyAction,
  createPropertyAction,
  restorePropertyAction,
  updatePropertyAction,
} from "@/app/(dashboard)/properties/actions";

export function CreatePropertyDialog({
  managerOptions,
  canAssignManagers,
}: {
  managerOptions: StaffOption[];
  canAssignManagers: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New property
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New property</DialogTitle>
          <DialogDescription>
            Create the property first, then add its units.
          </DialogDescription>
        </DialogHeader>
        <PropertyForm
          action={createPropertyAction}
          mode="create"
          managerOptions={managerOptions}
          canAssignManagers={canAssignManagers}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditPropertyDialog({
  property,
  managerOptions,
  canAssignManagers,
}: {
  property: PropertyDetail;
  managerOptions: StaffOption[];
  canAssignManagers: boolean;
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
          <DialogTitle>Edit property</DialogTitle>
          <DialogDescription>Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <PropertyForm
          action={updatePropertyAction}
          mode="edit"
          propertyId={property.id}
          defaultValues={{
            name: property.name,
            address: property.address,
            county: property.county,
            managerIds: property.managerIds,
            notes: property.notes ?? "",
          }}
          managerOptions={managerOptions}
          canAssignManagers={canAssignManagers}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ArchivePropertyButton({
  property,
  action = archivePropertyAction,
  label,
}: {
  property: PropertyDetail;
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
      title={`Archive ${property.name}?`}
      description={
        <>
          The property disappears from active lists but its units, leases and
          history stay intact. You must end all active leases first.
        </>
      }
      confirmLabel="Archive property"
      action={action}
      hiddenFields={{ propertyId: property.id }}
      requireReason
      reasonLabel="Reason for archiving"
    />
  );
}

export function RestorePropertyButton({ property }: { property: PropertyDetail }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <ArchiveRestore className="size-4" />
          Restore
        </Button>
      }
      title={`Restore ${property.name}?`}
      description="The property becomes active again and is visible to its assigned managers."
      confirmLabel="Restore property"
      action={restorePropertyAction}
      hiddenFields={{ propertyId: property.id }}
      requireReason
      reasonLabel="Reason for restoring"
      destructive={false}
    />
  );
}
