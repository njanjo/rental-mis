"use client";

import { useState } from "react";
import { Plus, Wrench } from "lucide-react";

import {
  MaintenanceCreateForm,
  MaintenanceUpdateForm,
} from "@/components/maintenance/maintenance-forms";
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
import type {
  MaintenanceDetail,
  PropertyOption,
  StaffOption,
  UnitOption,
} from "@/lib/types/views";
import {
  createMaintenanceAction,
  updateMaintenanceAction,
} from "@/app/(dashboard)/maintenance/actions";

export function CreateMaintenanceDialog({
  propertyOptions,
  unitOptions,
  staffOptions,
  disabled,
}: {
  propertyOptions: PropertyOption[];
  unitOptions: UnitOption[];
  staffOptions: StaffOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="size-4" />
          Log request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>
            Record the issue once. Property managers can triage and assign it to
            maintenance staff.
          </DialogDescription>
        </DialogHeader>
        <MaintenanceCreateForm
          action={createMaintenanceAction}
          propertyOptions={propertyOptions}
          unitOptions={unitOptions}
          staffOptions={staffOptions}
        />
      </DialogContent>
    </Dialog>
  );
}

export function UpdateMaintenanceDialog({
  request,
  staffOptions,
  canAssign,
  action = updateMaintenanceAction,
}: {
  request: MaintenanceDetail;
  staffOptions: StaffOption[];
  canAssign: boolean;
  action?: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Wrench className="size-4" />
          Update request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update maintenance request</DialogTitle>
          <DialogDescription>
            Move the work forward, reassign it, or cancel it. Resolving and
            cancelling need a note and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <MaintenanceUpdateForm
          action={action}
          request={request}
          staffOptions={staffOptions}
          canAssign={canAssign}
        />
      </DialogContent>
    </Dialog>
  );
}
