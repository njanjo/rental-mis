import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Flag,
  UserRound,
  Wrench,
} from "lucide-react";

import { UpdateMaintenanceDialog } from "@/components/maintenance/maintenance-dialogs";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { getMaintenance } from "@/services/maintenance";
import { listStaffOptions } from "@/services/staff";

export const metadata: Metadata = { title: "Maintenance request" };

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability([
    "manage_maintenance",
    "update_maintenance",
  ]);
  const { id } = await params;

  let request;
  try {
    request = await getMaintenance(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const canManage = can(user.role, "manage_maintenance");
  const canViewPortfolio =
    can(user.role, "manage_units") || can(user.role, "view_financials");
  const isClosed = request.status === "resolved" || request.status === "cancelled";

  const staffOptions = isClosed
    ? []
    : await listStaffOptions(["admin", "property_manager", "maintenance"], {
        propertyId: request.propertyId,
      });

  return (
    <>
      <PageHeader
        title={request.title}
        description={`${request.propertyName} · Unit ${request.unitNumber}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/maintenance">Back</Link>
            </Button>
            {isClosed ? null : (
              <UpdateMaintenanceDialog
                request={request}
                staffOptions={staffOptions}
                canAssign={canManage}
              />
            )}
          </div>
        }
      />

      {request.status === "resolved" ? (
        <Card className="mb-4 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-3 text-sm">
            Resolved {formatDateTime(request.resolvedAt)}
            {request.resolutionNote ? `: ${request.resolutionNote}` : "."}
          </CardContent>
        </Card>
      ) : null}

      {request.status === "cancelled" ? (
        <Card className="mb-4 border-slate-500/40 bg-slate-500/5">
          <CardContent className="py-3 text-sm">
            Cancelled {formatDateTime(request.closedAt)}
            {request.resolutionNote ? `: ${request.resolutionNote}` : "."}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Wrench className="size-3.5" /> Status
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <StatusBadge status={request.status} />
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Flag className="size-3.5" /> Priority
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <StatusBadge status={request.priority} />
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <UserRound className="size-3.5" /> Assigned to
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-sm font-medium">
              {request.assignedToName ?? (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CalendarDays className="size-3.5" /> Logged
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-sm">{formatDateTime(request.createdAt)}</p>
            <p className="text-xs text-muted-foreground">
              by {request.createdByName ?? request.createdBy}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">The issue</CardTitle>
            <CardDescription>
              What was reported and any progress notes recorded so far.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <p className="whitespace-pre-line">{request.issue}</p>

            {request.notes ? (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Latest note
                </p>
                <p className="mt-1 whitespace-pre-line">{request.notes}</p>
              </div>
            ) : null}

            {request.resolutionNote ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {request.status === "cancelled" ? "Cancellation reason" : "Resolution"}
                </p>
                <p className="mt-1 whitespace-pre-line">{request.resolutionNote}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4" /> Where
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </p>
                {canViewPortfolio ? (
                  <Link
                    href={`/properties/${request.propertyId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {request.propertyName}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 font-medium">{request.propertyName}</p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Unit
                </p>
                {canViewPortfolio ? (
                  <Link
                    href={`/units/${request.unitId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {request.unitNumber}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 font-medium">{request.unitNumber}</p>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                asChild
                className="w-full justify-between"
              >
                <Link href={`/maintenance?property=${request.propertyId}`}>
                  All requests here
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Logged
                </p>
                <p className="mt-1">{formatDateTime(request.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDateTime(request.updatedAt)}</p>
              </div>
              {request.resolvedAt ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Resolved
                  </p>
                  <p className="mt-1">{formatDateTime(request.resolvedAt)}</p>
                </div>
              ) : null}
              {request.closedAt ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Cancelled
                  </p>
                  <p className="mt-1">{formatDateTime(request.closedAt)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
