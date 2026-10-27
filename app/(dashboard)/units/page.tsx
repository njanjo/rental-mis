import type { Metadata } from "next";
import { DoorOpen } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Units" };

export default function UnitsPage() {
  return (
    <ModulePlaceholder
      title="Units"
      description="Rent, deposit, occupancy and the active lease for every unit."
      icon={DoorOpen}
      phase="Phase 3 · Operations"
      docSection="Spec §4 + §11 · /units"
      planned={[
        "Unit numbers, rent and deposit in integer minor units",
        "Vacant / occupied / maintenance status",
        "Current tenant and active lease on the unit row",
        "Bulk-create units when onboarding a property",
      ]}
    />
  );
}
