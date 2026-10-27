import { z } from "zod";

import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from "@/lib/types";

export const maintenanceCreateSchema = z.object({
  propertyId: z.string().trim().min(1, { message: "Choose a property." }),
  unitId: z.string().trim().min(1, { message: "Choose a unit." }),
  title: z
    .string()
    .trim()
    .min(5, { message: "Summarise the issue in at least 5 characters." })
    .max(120, { message: "Keep the title under 120 characters." }),
  issue: z
    .string()
    .trim()
    .min(5, { message: "Describe the issue." })
    .max(2000, { message: "Keep this under 2000 characters." }),
  priority: z.enum(MAINTENANCE_PRIORITIES, { message: "Choose a priority." }),
  assignedTo: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;

export const maintenanceUpdateSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES, { message: "Choose a status." }),
  priority: z.enum(MAINTENANCE_PRIORITIES, { message: "Choose a priority." }),
  assignedTo: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  note: z
    .string()
    .trim()
    .max(1000, { message: "Keep this under 1000 characters." })
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;

export const MAINTENANCE_TRANSITIONS: Record<
  (typeof MAINTENANCE_STATUSES)[number],
  (typeof MAINTENANCE_STATUSES)[number][]
> = {
  open: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
};

export function canTransitionMaintenance(
  from: (typeof MAINTENANCE_STATUSES)[number],
  to: (typeof MAINTENANCE_STATUSES)[number],
): boolean {
  if (from === to) return true;
  return MAINTENANCE_TRANSITIONS[from].includes(to);
}
