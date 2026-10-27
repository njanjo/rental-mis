import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Wrench } from "lucide-react";

import { CreateMaintenanceDialog } from "@/components/maintenance/maintenance-dialogs";
import { CursorPagination } from "@/components/shared/cursor-pagination";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { MaintenanceListItem } from "@/lib/types/views";
import { listMaintenance } from "@/services/maintenance";
import { getPropertyOptions } from "@/services/properties";
import { listStaffOptions } from "@/services/staff";
import { getUnitOptions } from "@/services/units";

export const metadata: Metadata = { title: "Maintenance" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const STATUS_VALUES = ["open", "assigned", "in_progress", "resolved", "cancelled"];
const PRIORITY_VALUES = ["low", "medium", "high", "urgent"];

const columns: DataTableColumn<MaintenanceListItem>[] = [
  {
    key: "title",
    header: "Request",
    cell: (request) => (
      <Link
        href={`/maintenance/${request.id}`}
        className="group flex flex-col gap-0.5"
      >
        <span className="font-medium group-hover:underline">{request.title}</span>
        <span className="text-xs text-muted-foreground">
          {request.propertyName} · {request.unitNumber}
        </span>
      </Link>
    ),
  },
  {
    key: "priority",
    header: "Priority",
    cell: (request) => <StatusBadge status={request.priority} />,
    className: "hidden w-24 sm:table-cell",
    headerClassName: "hidden sm:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (request) => <StatusBadge status={request.status} />,
    className: "w-28",
  },
  {
    key: "assignee",
    header: "Assigned to",
    cell: (request) => (
      <span className="text-sm">
        {request.assignedToName ?? (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </span>
    ),
    className: "hidden md:table-cell",
    headerClassName: "hidden md:table-cell",
  },
  {
    key: "created",
    header: "Logged",
    cell: (request) => (
      <span className="text-xs text-muted-foreground">
        {formatDate(request.createdAt)}
      </span>
    ),
    className: "hidden lg:table-cell",
    headerClassName: "hidden lg:table-cell",
  },
  {
    key: "open",
    header: "",
    cell: (request) => (
      <Link
        href={`/maintenance/${request.id}`}
        aria-label={`Open ${request.title}`}
        className="flex justify-end text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
    className: "w-10",
  },
];

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAnyCapability([
    "manage_maintenance",
    "update_maintenance",
  ]);
  const params = await searchParams;

  const q = first(params.q);
  const propertyId = first(params.property);
  const statusParam = first(params.status);
  const priorityParam = first(params.priority);
  const assignee = first(params.assignee);
  const cursor = first(params.cursor);

  const status = STATUS_VALUES.includes(statusParam)
    ? (statusParam as MaintenanceListItem["status"])
    : undefined;
  const priority = PRIORITY_VALUES.includes(priorityParam)
    ? (priorityParam as MaintenanceListItem["priority"])
    : undefined;

  const canManage = can(user.role, "manage_maintenance");

  const [propertyOptions, unitOptions, staffOptions, result] = await Promise.all([
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    canManage
      ? getUnitOptions(user, { includeOccupied: true }).catch((error) => {
          if (isServiceError(error) && error.code === "forbidden") return [];
          throw error;
        })
      : Promise.resolve([]),
    listStaffOptions(["admin", "property_manager", "maintenance"]).catch(
      () => [],
    ),
    listMaintenance(user, {
      q,
      propertyId,
      status,
      priority,
      assignedTo: assignee,
      cursor,
    }).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return { items: [], nextCursor: null };
      }
      throw error;
    }),
  ]);

  const filtersActive = Boolean(
    q || propertyId || statusParam || priorityParam || assignee,
  );
  const canCreate = canManage && propertyOptions.length > 0;

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Log issues, set priority, assign work and track progress."
        actions={
          canManage ? (
            <CreateMaintenanceDialog
              propertyOptions={propertyOptions}
              unitOptions={unitOptions}
              staffOptions={staffOptions}
              disabled={!canCreate}
            />
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search issue, unit or property…"
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
              { value: "assigned", label: "Assigned" },
              { value: "in_progress", label: "In progress" },
              { value: "resolved", label: "Resolved" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            key: "priority",
            label: "Priority",
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ],
          },
          {
            key: "assignee",
            label: "Assignee",
            options: staffOptions.map((person) => ({
              value: person.uid,
              label: person.fullName,
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
            icon={Wrench}
            title={filtersActive ? "No matching requests" : "No maintenance requests"}
            description={
              filtersActive
                ? "Try a different search or clear the filters."
                : canManage
                  ? "Log an issue to start tracking repairs and turnaround."
                  : "Requests for your properties will appear here."
            }
            action={
              canCreate && !filtersActive ? (
                <CreateMaintenanceDialog
                  propertyOptions={propertyOptions}
                  unitOptions={unitOptions}
                  staffOptions={staffOptions}
                />
              ) : null
            }
          />
        }
      />

      <CursorPagination
        basePath="/maintenance"
        params={{
          q,
          property: propertyId,
          status,
          priority,
          assignee,
          cursor: undefined,
        }}
        nextCursor={result.nextCursor}
        hasCursor={Boolean(cursor)}
      />
    </>
  );
}
