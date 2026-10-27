import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";

import { CreateTenantDialog } from "@/components/tenants/tenant-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatPhone } from "@/lib/format";
import type { TenantListItem } from "@/lib/types/views";
import { getPropertyOptions } from "@/services/properties";
import { listTenants } from "@/services/tenants";

export const metadata: Metadata = { title: "Tenants" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const columns: DataTableColumn<TenantListItem>[] = [
  {
    key: "tenant",
    header: "Tenant",
    cell: (tenant) => (
      <Link href={`/tenants/${tenant.id}`} className="group flex flex-col gap-0.5">
        <span className="font-medium group-hover:underline">{tenant.fullName}</span>
        <span className="text-xs text-muted-foreground">
          {formatPhone(tenant.phoneE164)}
        </span>
      </Link>
    ),
  },
  {
    key: "tenancy",
    header: "Current tenancy",
    cell: (tenant) =>
      tenant.propertyName ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">{tenant.propertyName}</span>
          <span className="text-xs text-muted-foreground">
            {tenant.unitNumber ? `Unit ${tenant.unitNumber}` : "No unit"}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Not leased</span>
      ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "properties",
    header: "Properties",
    cell: (tenant) => (
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {tenant.propertyNames.length > 0
          ? tenant.propertyNames.join(", ")
          : "—"}
      </span>
    ),
    className: "hidden xl:table-cell",
    headerClassName: "hidden xl:table-cell",
  },
  {
    key: "sms",
    header: "SMS",
    cell: (tenant) =>
      tenant.consentSms ? (
        <Badge variant="secondary" className="font-normal">
          Opted in
        </Badge>
      ) : (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          Opted out
        </Badge>
      ),
    className: "hidden sm:table-cell w-24",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (tenant) => <StatusBadge status={tenant.status} />,
    className: "w-24",
  },
  {
    key: "open",
    header: "",
    cell: (tenant) => (
      <Link
        href={`/tenants/${tenant.id}`}
        aria-label={`Open ${tenant.fullName}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["manage_tenants", "view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const status =
    statusParam === "active" ||
    statusParam === "inactive" ||
    statusParam === "former" ||
    statusParam === "all"
      ? statusParam
      : undefined;
  const cursor = first(params.cursor);

  const canManage = can(user.role, "manage_tenants");

  const [propertyOptions, result] = await Promise.all([
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    listTenants(user, { q, propertyId, status, cursor }).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return { items: [], nextCursor: null };
      }
      throw error;
    }),
  ]);

  const filtersActive = Boolean(q || propertyId || statusParam);

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Contact records, current tenancy and SMS consent for every tenant."
        actions={
          canManage ? (
            <CreateTenantDialog
              propertyOptions={propertyOptions}
              defaultPropertyId={propertyId || undefined}
              disabled={propertyOptions.length === 0}
            />
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search name or phone…"
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
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "former", label: "Former" },
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
            icon={Users}
            title={filtersActive ? "No matching tenants" : "No tenants yet"}
            description={
              filtersActive
                ? "Try a different search or clear the filters."
                : canManage
                  ? "Add a tenant before creating their first lease."
                  : "Tenants will appear here once a property manager adds them."
            }
            action={
              canManage && !filtersActive && propertyOptions.length > 0 ? (
                <CreateTenantDialog propertyOptions={propertyOptions} />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/tenants"
        params={{ q, property: propertyId, status, cursor: undefined }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
