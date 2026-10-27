import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";

import { GenerateInvoicesDialog } from "@/components/invoices/invoice-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { currentPeriodKey, isPeriodKey, periodLabel, recentPeriodKeys } from "@/lib/billing";
import { isServiceError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/types";
import type { InvoiceListItem } from "@/lib/types/views";
import { listInvoices } from "@/services/invoices";
import { getPropertyOptions } from "@/services/properties";

export const metadata: Metadata = { title: "Invoices" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const STATUS_VALUES: InvoiceStatus[] = [
  "open",
  "partial",
  "paid",
  "overdue",
  "void",
];

const columns: DataTableColumn<InvoiceListItem>[] = [
  {
    key: "tenant",
    header: "Invoice",
    cell: (invoice) => (
      <Link href={`/invoices/${invoice.id}`} className="group flex flex-col gap-0.5">
        <span className="font-medium group-hover:underline">
          {invoice.tenantName}
        </span>
        <span className="text-xs text-muted-foreground">
          {invoice.propertyName} · {invoice.unitNumber || "Unit"}
        </span>
      </Link>
    ),
  },
  {
    key: "period",
    header: "Period",
    cell: (invoice) => (
      <span className="whitespace-nowrap text-sm">{invoice.periodLabel}</span>
    ),
    className: "hidden sm:table-cell",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "due",
    header: "Due",
    cell: (invoice) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(invoice.dueDate)}
      </span>
    ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "due-amount",
    header: "Amount",
    cell: (invoice) => (
      <span className="whitespace-nowrap text-sm tabular-nums">
        {formatMoney(invoice.amountDueMinor)}
      </span>
    ),
    className: "hidden text-right lg:table-cell",
    headerClassName: "hidden text-right lg:table-cell",
  },
  {
    key: "paid",
    header: "Paid",
    cell: (invoice) => (
      <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
        {formatMoney(invoice.amountPaidMinor)}
      </span>
    ),
    className: "hidden text-right lg:table-cell",
    headerClassName: "hidden text-right lg:table-cell",
  },
  {
    key: "balance",
    header: "Balance",
    cell: (invoice) => (
      <span
        className={
          invoice.balanceMinor > 0
            ? "whitespace-nowrap text-sm font-medium tabular-nums"
            : "whitespace-nowrap text-sm tabular-nums text-muted-foreground"
        }
      >
        {formatMoney(invoice.balanceMinor)}
      </span>
    ),
    className: "text-right",
    headerClassName: "text-right",
  },
  {
    key: "status",
    header: "Status",
    cell: (invoice) => <StatusBadge status={invoice.status} />,
    className: "w-28",
  },
  {
    key: "open",
    header: "",
    cell: (invoice) => (
      <Link
        href={`/invoices/${invoice.id}`}
        aria-label={`Open invoice for ${invoice.tenantName}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const periodParam = first(params.period);
  const cursor = first(params.cursor);

  const status = STATUS_VALUES.includes(statusParam as InvoiceStatus)
    ? (statusParam as InvoiceStatus)
    : undefined;
  const periodKey = isPeriodKey(periodParam) ? periodParam : undefined;

  const canManage = can(user.role, "manage_invoices");
  const periodOptions = recentPeriodKeys(12, new Date());

  const [propertyOptions, result] = await Promise.all([
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    listInvoices(user, {
      q,
      propertyId,
      status,
      periodKey,
      cursor,
    }).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return { items: [], nextCursor: null };
      }
      throw error;
    }),
  ]);

  const filtersActive = Boolean(q || propertyId || statusParam || periodParam);
  const canGenerate = canManage && propertyOptions.length > 0;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="One invoice per lease and billing period, with balance and overdue state."
        actions={
          canManage ? (
            <GenerateInvoicesDialog
              defaultPeriod={currentPeriodKey()}
              disabled={!canGenerate}
            />
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search tenant, unit, property or period…"
        filters={[
          {
            key: "property",
            label: "Property",
            options: propertyOptions.map((property) => ({
              value: property.id,
              label: property.name,
            })),
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open" },
              { value: "partial", label: "Part paid" },
              { value: "paid", label: "Paid" },
              { value: "overdue", label: "Overdue" },
              { value: "void", label: "Void" },
            ],
          },
          {
            key: "period",
            label: "Period",
            options: periodOptions.map((key) => ({
              value: key,
              label: periodLabel(key),
            })),
          },
        ]}
        className="mb-4"
      />

      <DataTable
        columns={columns}
        rows={result.items}
        empty={
          <EmptyState
            icon={FileText}
            title={filtersActive ? "No matching invoices" : "No invoices yet"}
            description={
              filtersActive
                ? "Try a different search, period or status."
                : canManage
                  ? "Generate a billing month to raise invoices for every active lease."
                  : "Invoices raised for your properties will appear here."
            }
            action={
              canGenerate && !filtersActive ? (
                <GenerateInvoicesDialog defaultPeriod={currentPeriodKey()} />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/invoices"
        params={{
          q,
          property: propertyId,
          status,
          period: periodKey,
          cursor: undefined,
        }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
