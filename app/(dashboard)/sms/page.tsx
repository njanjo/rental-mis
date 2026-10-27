import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { requireAnyCapability } from "@/lib/auth/session";

export const metadata: Metadata = { title: "SMS" };

export default async function SmsPage() {
  await requireAnyCapability(["manage_sms"]);
  return (
    <ModulePlaceholder
      title="SMS"
      description="Templates, previews, bulk campaigns and delivery logs via Beam SMS."
      icon={MessageSquare}
      phase="Phase 6 · Automation"
      docSection="Spec §8 + §11 · /sms"
      planned={[
        "Outbox decoupled from payment writes — SMS failure never rolls back a payment",
        "Templates: receipt, rent reminder, arrears, lease expiry, announcement",
        "Exponential backoff, max attempts, dead-letter visibility",
        "Beam provider adapter isolated in services/sms/providers",
        "Campaign IDs to suppress duplicate bulk sends",
      ]}
    />
  );
}
