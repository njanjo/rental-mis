import type { Metadata } from "next";
import { Banknote } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireAnyCapability } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  await requireAnyCapability(["view_financials"]);
  return (
    <ModulePlaceholder
      title="Payments"
      description="Live payment feed, allocations, reversals and the unmatched queue."
      icon={Banknote}
      phase="Phase 5 · Payments"
      docSection="Spec §5–7 + §11 · /payments"
      planned={[
        "Idempotent ingestion: provider + transaction reference",
        "M-Pesa Daraja callbacks and bank feeds behind one normaliser",
        "Allocation to the oldest outstanding invoice",
        "Unmatched queue — never guess a tenant from amount or name",
        "Append-only ledger with reversal events and reasons",
      ]}
    />
  );
}
