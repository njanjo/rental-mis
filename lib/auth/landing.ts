import type { Role } from "@/lib/types";

/**
 * Where a role lands after sign-in. Maintenance staff have no financial
 * visibility, so they start on their work queue rather than the dashboard.
 */
export function defaultLandingPath(role: Role): string {
  if (role === "maintenance") return "/maintenance";
  return "/dashboard";
}
