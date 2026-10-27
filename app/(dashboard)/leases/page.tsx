import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ScrollText } from "lucide-react";

import { CreateLeaseDialog } from "@/components/leases/lease-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDate, formatMoney, formatPhone } from "@/lib/format";
import type { LeaseListItem } from "@/lib/types/views";
import { listLeases } from "@/services/leases";
import { getPropertyOptions } from "@/services/properties";
import { getTenantOptions } from "@/services/tenants";
import { getUnitOptions } from "@/services/units";

export const metadata: Metadata = { title: "Leases" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const columns: DataTableColumn<LeaseListItem>[] = [
  {
    key: "tenant",
    header: "Tenant",
    cell: (lease) => (
      <Link href={`/leases/${lease.id}`} className="group flex flex-col gap-0.5">
        <span className="font-medium group-hover:underline">
          {lease.tenantName}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatPhone(lease.tenantPhone)}
        </span>
      </Link>
    ),
  },
  {
    key: "unit",
    header: "Unit",
    cell: (lease) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">
          {lease.propertyName} · {lease.unitNumber}
        </span>
        <span className="text-xs text-muted-foreground">
          Due day {lease.dueDay}
        </span>
      </div>
    ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "period",
    header: "Period",
    cell: (lease) => (
      <span className="text-xs text-muted-foreground">
        {formatDate(lease.startDate)} → {formatDate(lease.endDate)}
      </span>
    ),
    className: "hidden lg:table-cell",
    headerClassName: "hidden lg:table-cell",
  },
  {
    key: "rent",
    header: "Rent",
    cell: (lease) => (
      <span className="tabular-nums text-sm">
        {formatMoney(lease.rentAmountMinor)}
      </span>
    ),
    className: "hidden sm:table-cell",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (lease) => <StatusBadge status={lease.status} />,
    className: "w-28",
  },
  {
    key: "open",
    header: "",
    cell: (lease) => (
      <Link
        href={`/leases/${lease.id}`}
        aria-label={`Open lease for ${lease.tenantName}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["manage_leases", "view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const status =
    statusParam === "pending" ||
    statusParam === "active" ||
    statusParam === "expired" ||
    statusParam === "terminated" ||
    statusParam === "all"
      ? statusParam
      : undefined;
  const cursor = first(params.cursor);

  const canManage = can(user.role, "manage_leases");

  const [propertyOptions, tenantOptions, unitOptions, result] = await Promise.all([
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    canManage
      ? getTenantOptions(user).catch((error) => {
          if (isServiceError(error) && error.code === "forbidden") return [];
          throw error;
        })
      : Promise.resolve([]),
    canManage
      ? getUnitOptions(user).catch((error) => {
          if (isServiceError(error) && error.code === "forbidden") return [];
          throw error;
        })
      : Promise.resolve([]),
    listLeases(user, { q, propertyId, status, cursor }).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return { items: [], nextCursor: null };
      }
      throw error;
    }),
  ]);

  const filtersActive = Boolean(q || propertyId || statusParam);
  const canCreate = canManage && tenantOptions.length > 0 && unitOptions.length > 0;

  return (
    <>
      <PageHeader
        title="Leases"
        description="Agreed terms, dates and status for every tenancy."
        actions={
          canManage ? (
            <CreateLeaseDialog
              tenantOptions={tenantOptions}
              unitOptions={unitOptions}
              disabled={!canCreate}
            />
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search tenant, unit or property…"
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
              { value: "pending", label: "Pending" },
              { value: "active", label: "Active" },
              { value: "expired", label: "Expired" },
              { value: "terminated", label: "Terminated" },
              { value: "all", label: "All" },
            ],
          },
        ]}
        className="mb-4"
      />

      <DataTable
        columns={columns}
        rows={result.items}
        empty={
          <EmptyState
            icon={ScrollText}
            title={filtersActive ? "No matching leases" : "No leases yet"}
            description={
              filtersActive
                ? "Try a different search or clear the filters."
                : canManage
                  ? "Start a lease to place a tenant in a vacant unit."
                  : "Leases will appear here once a property manager creates them."
            }
            action={
              canCreate && !filtersActive ? (
                <CreateLeaseDialog
                  tenantOptions={tenantOptions}
                  unitOptions={unitOptions}
                />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/leases"
        params={{ q, property: propertyId, status, cursor: undefined }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
