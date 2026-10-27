import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Inbox } from "lucide-react";

import {
  IgnoreUnmatchedDialog,
  ResolveUnmatchedDialog,
} from "@/components/payments/payment-dialogs";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requireAnyCapability } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { ReviewStatus } from "@/lib/types";
import type {
  TenantOption,
  UnmatchedPaymentListItem,
} from "@/lib/types/views";
import { listUnmatched } from "@/services/payments";
import { getTenantOptions } from "@/services/tenants";

export const metadata: Metadata = { title: "Unmatched payments" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const STATUS_VALUES = ["open", "pending", "assigned", "resolved", "ignored", "all"];

function columnsFor(
  tenantOptions: TenantOption[],
): DataTableColumn<UnmatchedPaymentListItem>[] {
  return [
    {
      key: "payer",
      header: "Payment",
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {row.payerName ?? "Unknown payer"}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.provider} · {row.providerTransactionId}
            {row.payerPhone ? ` · ${row.payerPhone}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => (
        <span className="whitespace-nowrap text-sm font-medium tabular-nums">
          {formatMoney(row.amountMinor)}
        </span>
      ),
      className: "text-right",
      headerClassName: "text-right",
    },
    {
      key: "received",
      header: "Received",
      cell: (row) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.receivedAt)}
        </span>
      ),
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "reason",
      header: "Why it is here",
      cell: (row) => (
        <div className="max-w-xs">
          <p className="text-sm">{row.reason}</p>
          {row.candidateTenantNames.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Possible: {row.candidateTenantNames.join(", ")}
            </p>
          ) : null}
        </div>
      ),
      className: "hidden lg:table-cell",
      headerClassName: "hidden lg:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.reviewStatus} />,
      className: "w-24",
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.reviewStatus === "pending" || row.reviewStatus === "assigned" ? (
          <div className="flex justify-end gap-2">
            <IgnoreUnmatchedDialog row={row} />
            <ResolveUnmatchedDialog row={row} tenantOptions={tenantOptions} />
          </div>
        ) : (
          <div className="flex flex-col items-end text-xs text-muted-foreground">
            <span>{row.reviewedByName ?? "Closed"}</span>
            {row.reviewedAt ? (
              <span>{formatDateTime(row.reviewedAt)}</span>
            ) : null}
          </div>
        ),
      className: "w-56",
    },
  ];
}

export default async function UnmatchedPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["reconcile_payments"]);
  const params = await searchParams;

  const statusParam = first(params.status);
  const status = STATUS_VALUES.includes(statusParam)
    ? (statusParam as ReviewStatus | "open" | "all")
    : "open";

  const [tenantOptions, result] = await Promise.all([
    getTenantOptions(user),
    listUnmatched(user, { status }),
  ]);

  const rows = result.items;
  const openOnly = status === "open";

  return (
    <>
      <PageHeader
        title="Unmatched payments"
        description="Money that arrived without a reliable tenant match. Nothing here is guessed; a person matches it."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/payments">
              <ChevronLeft className="size-4" />
              All payments
            </Link>
          </Button>
        }
      />

      <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-600" />
          The queue is shared across properties
        </p>
        <p className="mt-1 text-muted-foreground">
          A payment with no tenant has no property to scope by, so anyone who
          can reconcile payments sees the same queue. Matching still requires
          access to the chosen tenant&apos;s property.
        </p>
      </div>

      <FilterBar
        searchPlaceholder="Search is not used in the queue"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open (pending + assigned)" },
              { value: "pending", label: "Pending" },
              { value: "assigned", label: "Assigned" },
              { value: "resolved", label: "Resolved" },
              { value: "ignored", label: "Ignored" },
              { value: "all", label: "All" },
            ],
          },
        ]}
        className="mb-4"
      />

      <DataTable
        columns={columnsFor(tenantOptions)}
        rows={rows}
        empty={
          <EmptyState
            icon={Inbox}
            title="Nothing waiting"
            description={
              openOnly
                ? "Every received payment has been matched or ignored."
                : "No payments match this filter."
            }
          />
        }
      />

      <p className="mt-4 text-xs text-muted-foreground">
        {openOnly
          ? "Showing payments still awaiting a decision."
          : `Showing ${rows.length} payment${rows.length === 1 ? "" : "s"}.`}
      </p>
    </>
  );
}
