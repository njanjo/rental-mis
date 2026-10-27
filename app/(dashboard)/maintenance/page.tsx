import type { Metadata } from "next";
import { Wrench } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Maintenance" };

export default function MaintenancePage() {
  return (
    <ModulePlaceholder
      title="Maintenance"
      description="Log issues, set priority, assign work and track progress."
      icon={Wrench}
      phase="Phase 3 · Operations"
      docSection="Spec §4 + §11 · /maintenance"
      planned={[
        "Issue, priority (low → urgent) and status",
        "Assign to maintenance staff scoped by property",
        "Progress updates without financial access",
        "Resolved timestamps for turnaround reporting",
      ]}
    />
  );
}
