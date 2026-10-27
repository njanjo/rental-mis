import type { Metadata } from "next";
import { Users } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";

export const metadata: Metadata = { title: "Tenants" };

export default function TenantsPage() {
  return (
    <ModulePlaceholder
      title="Tenants"
      description="Contact records, unit, lease and payment history for every tenant."
      icon={Users}
      phase="Phase 3 · Operations"
      docSection="Spec §4 + §11 · /tenants"
      planned={[
        "Tenant profile with E.164 phone number and status",
        "National ID minimised — last 4 digits only in client-readable docs",
        "Link to current unit, lease and full payment history",
        "Consent and opt-out flags for SMS",
      ]}
    />
  );
}
