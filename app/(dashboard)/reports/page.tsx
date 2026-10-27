import type { Metadata } from "next";
import { TrendingUp } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireAnyCapability } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireAnyCapability(["export_reports"]);
  return (
    <ModulePlaceholder
      title="Reports"
      description="Income, arrears, occupancy and property performance — with CSV export."
      icon={TrendingUp}
      phase="Phase 7 · Reporting"
      docSection="Spec §11 · /reports"
      planned={[
        "Income by month, property and payment channel",
        "Arrears ageing buckets and tenant-level balances",
        "Occupancy history and property performance",
        "CSV export generated server-side and audit logged",
      ]}
    />
  );
}
