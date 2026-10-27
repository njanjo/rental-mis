import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";

import { CreatePropertyDialog } from "@/components/properties/property-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { requireAnyCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isServiceError } from "@/lib/errors";
import { KENYA_COUNTIES } from "@/lib/kenya";
import type { PropertyListItem } from "@/lib/types/views";
import { listProperties } from "@/services/properties";
import { listStaffOptions } from "@/services/staff";

export const metadata: Metadata = { title: "Properties" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const columns: DataTableColumn<PropertyListItem>[] = [
  {
    key: "name",
    header: "Property",
    cell: (property) => (
      <Link
        href={`/properties/${property.id}`}
        className="group flex flex-col gap-0.5"
      >
        <span className="font-medium group-hover:underline">{property.name}</span>
        <span className="text-xs text-muted-foreground">{property.address}</span>
      </Link>
    ),
  },
  {
    key: "county",
    header: "County",
    cell: (property) => <span className="text-sm">{property.county}</span>,
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "units",
    header: "Units",
    cell: (property) => (
      <span className="tabular-nums text-sm">{property.unitCount}</span>
    ),
    className: "w-20",
  },
  {
    key: "occupancy",
    header: "Occupied",
    cell: (property) => {
      const percent =
        property.unitCount === 0
          ? 0
          : Math.round((property.occupiedCount / property.unitCount) * 100);
      return (
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-sm">
            {property.occupiedCount}/{property.unitCount}
          </span>
          {property.unitCount > 0 ? (
            <Badge variant="secondary" className="font-normal tabular-nums">
              {percent}%
            </Badge>
          ) : null}
        </div>
      );
    },
    className: "w-32",
  },
  {
    key: "managers",
    header: "Managers",
    cell: (property) => (
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {property.managerNames.length > 0
          ? property.managerNames.join(", ")
          : "Unassigned"}
      </span>
    ),
    className: "hidden lg:table-cell",
    headerClassName: "hidden lg:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (property) => (
      <StatusBadge status={property.active ? "active" : "archived"} />
    ),
    className: "w-24",
  },
  {
    key: "open",
    header: "",
    cell: (property) => (
      <Link
        href={`/properties/${property.id}`}
        aria-label={`Open ${property.name}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["manage_properties", "view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const county = first(params.county);
  const cursor = first(params.cursor);
  const statusParam = first(params.status);
  const status =
    statusParam === "archived" || statusParam === "all" ? statusParam : "active";

  const canManage = can(user.role, "manage_properties");
  const canAssignManagers = user.role === "admin";

  const [result, managerOptions] = await Promise.all([
    listProperties(user, { q, county, status, cursor }).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return { items: [], nextCursor: null };
      }
      throw error;
    }),
    canManage
      ? listStaffOptions(["property_manager", "admin"])
      : Promise.resolve([]),
  ]);

  const filtersActive = Boolean(q || county || statusParam);

  return (
    <>
      <PageHeader
        title="Properties"
        description="Every building under management, with occupancy and assigned staff."
        actions={canManage ? (
          <CreatePropertyDialog
            managerOptions={managerOptions}
            canAssignManagers={canAssignManagers}
          />
        ) : null}
      />

      <FilterBar
        searchPlaceholder="Search name, address or county…"
        filters={[
          {
            key: "county",
            label: "County",
            options: KENYA_COUNTIES.map((item) => ({
              value: item.name,
              label: item.name,
            })),
          },
          {
            key: "status",
            label: "Status",
            allowAll: false,
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
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
            icon={Building2}
            title={filtersActive ? "No matching properties" : "No properties yet"}
            description={
              filtersActive
                ? "Try a different search or clear the filters."
                : canManage
                  ? "Create your first property, then add units to it."
                  : "Properties will appear here once an administrator creates them."
            }
            action={
              canManage && !filtersActive ? (
                <CreatePropertyDialog
                  managerOptions={managerOptions}
                  canAssignManagers={canAssignManagers}
                />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/properties"
        params={{ q, county, status, cursor: undefined }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
