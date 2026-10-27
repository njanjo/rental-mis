import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Properties" };

export default function PropertiesPage() {
  return (
    <ModulePlaceholder
      title="Properties"
      description="Property records, manager assignment and performance at a glance."
      icon={Building2}
      phase="Phase 3 · Operations"
      docSection="Spec §11 · /properties"
      planned={[
        "Create and edit properties (name, address, county)",
        "Assign property managers and scope them to properties",
        "Property detail with units, occupancy and active leases",
        "Archive a property without deleting history",
      ]}
    />
  );
}
