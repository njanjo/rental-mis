import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronRight, Inbox, ReceiptText } from "lucide-react";

import { RecordReceiptDialog } from "@/components/payments/payment-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  type PaymentProvider,
  type PaymentStatus,
} from "@/lib/types";
import type { PaymentListItem } from "@/lib/types/views";
import { countOpenUnmatched, listPayments } from "@/services/payments";
import { getPropertyOptions } from "@/services/properties";
import { getTenantOptions } from "@/services/tenants";

export const metadata: Metadata = { title: "Payments" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
  manual: "Cash",
};

const STATUS_LABELS: Record<PaymentStatus, string> = {
  received: "Received",
  confirmed: "Confirmed",
  allocated: "Allocated",
  unmatched: "Unmatched",
  rejected: "Rejected",
  reversed: "Reversed",
  reversal: "Reversal",
};

const columns: DataTableColumn<PaymentListItem>[] = [
  {
    key: "payment",
    header: "Payment",
    cell: (payment) => (
      <Link
        href={`/payments/${payment.id}`}
        className="group flex flex-col gap-0.5"
      >
        <span className="font-medium group-hover:underline">
          {payment.tenantName ?? payment.payerName ?? "Unmatched payment"}
        </span>
        <span className="text-xs text-muted-foreground">
          {PROVIDER_LABELS[payment.provider]} · {payment.providerTransactionId}
        </span>
      </Link>
    ),
  },
  {
    key: "property",
    header: "Property",
    cell: (payment) => (
      <span className="text-sm text-muted-foreground">
        {payment.propertyName ?? "—"}
      </span>
    ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "received",
    header: "Received",
    cell: (payment) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(payment.receivedAt)}
      </span>
    ),
    className: "hidden sm:table-cell",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "amount",
    header: "Amount",
    cell: (payment) => (
      <span
        className={
          payment.amountMinor < 0
            ? "whitespace-nowrap text-sm font-medium tabular-nums text-rose-600"
            : "whitespace-nowrap text-sm font-medium tabular-nums"
        }
      >
        {formatMoney(payment.amountMinor)}
      </span>
    ),
    className: "text-right",
    headerClassName: "text-right",
  },
  {
    key: "allocated",
    header: "Allocated",
    cell: (payment) => (
      <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
        {payment.status === "reversal"
          ? "—"
          : formatMoney(payment.allocatedMinor)}
      </span>
    ),
    className: "hidden text-right lg:table-cell",
    headerClassName: "hidden text-right lg:table-cell",
  },
  {
    key: "credit",
    header: "Credit",
    cell: (payment) => (
      <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
        {payment.creditAddedMinor > 0
          ? formatMoney(payment.creditAddedMinor)
          : "—"}
      </span>
    ),
    className: "hidden text-right xl:table-cell",
    headerClassName: "hidden text-right xl:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (payment) => <StatusBadge status={payment.status} />,
    className: "w-28",
  },
  {
    key: "open",
    header: "",
    cell: (payment) => (
      <Link
        href={`/payments/${payment.id}`}
        aria-label={`Open payment ${payment.providerTransactionId}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const providerParam = first(params.provider);
  const cursor = first(params.cursor);

  const status = PAYMENT_STATUSES.includes(statusParam as PaymentStatus)
    ? (statusParam as PaymentStatus)
    : undefined;
  const provider = PAYMENT_PROVIDERS.includes(providerParam as PaymentProvider)
    ? (providerParam as PaymentProvider)
    : undefined;

  const canRecord = can(user.role, "enter_manual_receipts");
  const canReconcile = can(user.role, "reconcile_payments");

  const [propertyOptions, tenantOptions, result, openUnmatched] =
    await Promise.all([
      getPropertyOptions(user).catch((error) => {
        if (isServiceError(error) && error.code === "forbidden") return [];
        throw error;
      }),
      canRecord
        ? getTenantOptions(user).catch((error) => {
            if (isServiceError(error) && error.code === "forbidden") return [];
            throw error;
          })
        : Promise.resolve([]),
      listPayments(user, {
        q,
        propertyId,
        status,
        provider,
        cursor,
      }).catch((error) => {
        if (isServiceError(error) && error.code === "forbidden") {
          return { items: [], nextCursor: null };
        }
        throw error;
      }),
      canReconcile
        ? countOpenUnmatched(user).catch((error) => {
            if (isServiceError(error) && error.code === "forbidden") return 0;
            throw error;
          })
        : Promise.resolve(0),
    ]);

  const filtersActive = Boolean(q || propertyId || statusParam || providerParam);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every receipt in one append-only ledger, with allocations, credit and reversals."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canReconcile ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/payments/unmatched">
                  <Inbox className="size-4" />
                  Unmatched
                  {openUnmatched > 0 ? (
                    <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      {openUnmatched}
                    </span>
                  ) : null}
                </Link>
              </Button>
            ) : null}
            {canRecord ? (
              <RecordReceiptDialog
                tenantOptions={tenantOptions}
                disabled={tenantOptions.length === 0}
              />
            ) : null}
          </div>
        }
      />

      <FilterBar
        searchPlaceholder="Search tenant, reference, payer or note…"
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
            options: PAYMENT_STATUSES.map((value) => ({
              value,
              label: STATUS_LABELS[value],
            })),
          },
          {
            key: "provider",
            label: "Provider",
            options: PAYMENT_PROVIDERS.map((value) => ({
              value,
              label: PROVIDER_LABELS[value],
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
            icon={Banknote}
            title={filtersActive ? "No matching payments" : "No payments yet"}
            description={
              filtersActive
                ? "Try a different search, property, status or provider."
                : canRecord
                  ? "Record a confirmed M-Pesa or bank receipt to start the ledger."
                  : "Payments recorded for your properties will appear here."
            }
            action={
              canRecord && !filtersActive ? (
                <RecordReceiptDialog tenantOptions={tenantOptions} />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/payments"
        params={{
          q,
          property: propertyId,
          status,
          provider,
          cursor: undefined,
        }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />

      {canRecord ? (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ReceiptText className="size-3.5" />
          Duplicate references are rejected. Unknown payers stay in the unmatched
          queue until a person matches them.
        </p>
      ) : null}
    </>
  );
}
