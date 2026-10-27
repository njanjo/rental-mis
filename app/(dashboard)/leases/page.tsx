import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Leases" };

export default function LeasesPage() {
  return (
    <ModulePlaceholder
      title="Leases"
      description="Terms, dates, renewals and status for every tenancy."
      icon={ScrollText}
      phase="Phase 3 · Operations"
      docSection="Spec §4 + §11 · /leases"
      planned={[
        "Start/end dates, rent and deposit per lease",
        "Due day (1–28) driving invoice generation",
        "Renewal and termination flows with audit trail",
        "Daily expiry flagging (Phase 6 job)",
      ]}
    />
  );
}
