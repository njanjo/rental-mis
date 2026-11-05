import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { RunSmsJobButtons } from "@/components/sms/run-sms-job-buttons";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { requireAnyCapability } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listSmsOutbox, type SmsOutboxListItem } from "@/services/sms";

export const metadata: Metadata = { title: "SMS" };

const columns: DataTableColumn<SmsOutboxListItem>[] = [
  {
    key: "status",
    header: "Status",
    cell: (item) => <StatusBadge status={item.status} />,
  },
  {
    key: "templateKey",
    header: "Template",
    cell: (item) => item.templateKey.replace(/_/g, " "),
  },
  {
    key: "phoneE164",
    header: "To",
    cell: (item) => item.phoneE164,
  },
  {
    key: "body",
    header: "Message",
    className: "max-w-md",
    cell: (item) => (
      <span className="block truncate text-sm">{item.body}</span>
    ),
  },
  {
    key: "attempts",
    header: "Tries",
    cell: (item) => String(item.attempts),
  },
  {
    key: "updatedAt",
    header: "Updated",
    cell: (item) => formatDateTime(item.updatedAt),
  },
  {
    key: "lastError",
    header: "",
    cell: (item) =>
      item.lastError ? (
        <span className="text-xs text-destructive" title={item.lastError}>
          error
        </span>
      ) : null,
  },
];

export default async function SmsPage() {
  await requireAnyCapability(["manage_sms"]);
  const outbox = await listSmsOutbox(50);

  return (
    <>
      <PageHeader
        title="SMS"
        description="Beam SMS outbox. Payment receipts queue with their payment; rent reminders queue from the scheduler or the button below."
        actions={<RunSmsJobButtons />}
      />

      <DataTable
        columns={columns}
        rows={outbox}
        empty={
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description="Receipts appear here when payments are recorded for tenants with SMS consent. Rent reminders queue on a schedule or from 'Generate reminders'."
          />
        }
      />
    </>
  );
}
