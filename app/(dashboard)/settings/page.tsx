import type { Metadata } from "next";
import { Settings } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireAnyCapability } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAnyCapability(["manage_settings"]);
  return (
    <ModulePlaceholder
      title="Settings"
      description="Staff roles, billing rules, SMS templates and integration health."
      icon={Settings}
      phase="Phase 3+ · Administration"
      docSection="Spec §3, §12 · /settings"
      planned={[
        "Invite staff and assign roles server-side only",
        "Property scope per staff member",
        "Billing rules: allocation order, overpayment, late fees",
        "Reminder windows and SMS templates",
        "Integration health: M-Pesa, banks, Beam SMS",
      ]}
    />
  );
}
