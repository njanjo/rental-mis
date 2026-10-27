import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, DoorOpen } from "lucide-react";

import { CreateUnitDialog } from "@/components/units/unit-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatMoney, formatPhone } from "@/lib/format";
import type { UnitListItem } from "@/lib/types/views";
import { getPropertyOptions } from "@/services/properties";
import { listUnits } from "@/services/units";

export const metadata: Metadata = { title: "Units" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const columns: DataTableColumn<UnitListItem>[] = [
  {
    key: "unit",
    header: "Unit",
    cell: (unit) => (
      <Link href={`/units/${unit.id}`} className="group flex flex-col gap-0.5">
        <span className="font-medium group-hover:underline">
          {unit.propertyName} · {unit.unitNumber}
        </span>
        <span className="text-xs text-muted-foreground">
          {unit.active ? "Active unit" : "Archived unit"}
        </span>
      </Link>
    ),
  },
  {
    key: "rent",
    header: "Rent",
    cell: (unit) => (
      <span className="tabular-nums text-sm">{formatMoney(unit.rentAmountMinor)}</span>
    ),
    className: "hidden sm:table-cell",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "deposit",
    header: "Deposit",
    cell: (unit) => (
      <span className="tabular-nums text-sm text-muted-foreground">
        {formatMoney(unit.depositAmountMinor)}
      </span>
    ),
    className: "hidden lg:table-cell",
    headerClassName: "hidden lg:table-cell",
  },
  {
    key: "tenant",
    header: "Current tenant",
    cell: (unit) =>
      unit.tenantName ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">{unit.tenantName}</span>
          <span className="text-xs text-muted-foreground">
            {formatPhone(unit.tenantPhone)}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (unit) => (
      <StatusBadge status={unit.active ? unit.status : "archived"} />
    ),
    className: "w-28",
  },
  {
    key: "open",
    header: "",
    cell: (unit) => (
      <Link
        href={`/units/${unit.id}`}
        aria-label={`Open unit ${unit.unitNumber}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability(["manage_units", "view_financials"]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const status =
    statusParam === "archived" ||
    statusParam === "vacant" ||
    statusParam === "occupied" ||
    statusParam === "maintenance"
      ? statusParam
      : undefined;
  const cursor = first(params.cursor);

  const canManage = can(user.role, "manage_units");

  const [propertyOptions, result] = await Promise.all([
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    listUnits(user, { q, propertyId, status, cursor }).catch((error) => {
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
        title="Units"
        description="Rent, deposit, occupancy and the current tenant for every unit."
        actions={
          canManage ? (
            <CreateUnitDialog
              propertyOptions={propertyOptions}
              defaultPropertyId={propertyId || undefined}
              disabled={propertyOptions.length === 0}
            />
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search unit, property or tenant…"
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
              { value: "vacant", label: "Vacant" },
              { value: "occupied", label: "Occupied" },
              { value: "maintenance", label: "Maintenance" },
              { value: "archived", label: "Archived" },
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
            icon={DoorOpen}
            title={filtersActive ? "No matching units" : "No units yet"}
            description={
              filtersActive
                ? "Try a different search or clear the filters."
                : canManage
                  ? "Add units to a property to start tracking occupancy and rent."
                  : "Units will appear here once a property manager adds them."
            }
            action={
              canManage && !filtersActive && propertyOptions.length > 0 ? (
                <CreateUnitDialog propertyOptions={propertyOptions} />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/units"
        params={{ q, property: propertyId, status, cursor: undefined }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
