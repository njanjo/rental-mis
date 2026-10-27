import type { Role } from "@/lib/types";

export const CAPABILITIES = [
  // management
  "manage_staff",
  "manage_properties",
  "manage_units",
  "manage_tenants",
  "manage_leases",
  // money
  "view_financials",
  "manage_invoices",
  "reconcile_payments",
  "approve_reversals",
  "enter_manual_receipts",
  "export_reports",
  // operations
  "manage_maintenance",
  "update_maintenance",
  "manage_sms",
  "view_audit",
  "manage_settings",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const READ_ONLY_CAPABILITIES: Capability[] = [
  "view_financials",
  "export_reports",
  "view_audit",
];

/**
 * Capability matrix mirroring the role table in the specification (section 3).
 * Roles are assigned server-side only; never let a user edit their own role.
 */
const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  admin: [...CAPABILITIES],
  property_manager: [
    "manage_properties",
    "manage_units",
    "manage_tenants",
    "manage_leases",
    "view_financials",
    "manage_maintenance",
    "update_maintenance",
    "export_reports",
  ],
  finance: [
    "view_financials",
    "manage_invoices",
    "reconcile_payments",
    "enter_manual_receipts",
    "export_reports",
    "manage_sms",
  ],
  maintenance: ["update_maintenance"],
  auditor: READ_ONLY_CAPABILITIES,
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function canAny(role: Role | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((capability) => can(role, capability));
}

export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole !== "admin") return [];
  return ["admin", "property_manager", "finance", "maintenance", "auditor"];
}

/** Roles that may be granted the Administrator role. */
export function isPrivileged(role: Role | null | undefined): boolean {
  return role === "admin";
}
