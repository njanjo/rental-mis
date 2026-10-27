import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireAnyCapability } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  await requireAnyCapability(["view_financials"]);
  return (
    <ModulePlaceholder
      title="Invoices"
      description="One invoice per lease and billing period, with balance and overdue state."
      icon={FileText}
      phase="Phase 4 · Billing"
      docSection="Spec §4–5 + §11 · /invoices"
      planned={[
        "Deterministic invoice IDs (lease + period key) — no duplicates on rerun",
        "Amount due, amount paid and balance in minor units",
        "Status: open, partial, paid, overdue, void",
        "Monthly generation job at Africa/Nairobi month boundaries",
      ]}
    />
  );
}
