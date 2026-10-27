import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Building2,
  DoorOpen,
  MapPin,
  Percent,
  UserRound,
} from "lucide-react";

import {
  ArchivePropertyButton,
  EditPropertyDialog,
  RestorePropertyButton,
} from "@/components/properties/property-dialogs";
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
import { formatDate } from "@/lib/format";
import { getProperty } from "@/services/properties";
import { listStaffOptions } from "@/services/staff";

export const metadata: Metadata = { title: "Property" };

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["manage_properties", "view_financials"]);
  const { id } = await params;

  let property;
  try {
    property = await getProperty(user, id);
  } catch (error) {
    if (isServiceError(error) && (error.code === "not_found" || error.code === "forbidden")) {
      notFound();
    }
    throw error;
  }

  const canManage = can(user.role, "manage_properties");
  const canAssignManagers = user.role === "admin";
  const managerOptions = canManage
    ? await listStaffOptions(["property_manager", "admin"])
    : [];

  const occupancy =
    property.unitCount === 0
      ? 0
      : Math.round((property.occupiedCount / property.unitCount) * 100);

  return (
    <>
      <PageHeader
        title={property.name}
        description={`${property.address} · ${property.county}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/properties">Back</Link>
            </Button>
            {canManage ? (
              <>
                <EditPropertyDialog
                  property={property}
                  managerOptions={managerOptions}
                  canAssignManagers={canAssignManagers}
                />
                {property.active ? (
                  <ArchivePropertyButton property={property} />
                ) : (
                  <RestorePropertyButton property={property} />
                )}
              </>
            ) : null}
          </div>
        }
      />

      {!property.active ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            This property is archived. Its history is preserved, but it no longer
            accepts new leases.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <DoorOpen className="size-3.5" /> Units
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-2xl font-semibold tabular-nums">{property.unitCount}</p>
            <p className="text-xs text-muted-foreground">Active units</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Percent className="size-3.5" /> Occupancy
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-2xl font-semibold tabular-nums">{occupancy}%</p>
            <p className="text-xs text-muted-foreground">
              {property.occupiedCount} of {property.unitCount} occupied
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <MapPin className="size-3.5" /> County
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-lg font-semibold">{property.county}</p>
            <p className="text-xs text-muted-foreground">Kenya</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <UserRound className="size-3.5" /> Managers
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-sm font-medium">
              {property.managerNames.length > 0
                ? property.managerNames.join(", ")
                : "Unassigned"}
            </p>
            <p className="text-xs text-muted-foreground">Property scope</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Property details</CardTitle>
              </div>
              <StatusBadge status={property.active ? "active" : "archived"} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Address
                </p>
                <p className="mt-1">{property.address}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  County
                </p>
                <p className="mt-1">{property.county}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="mt-1">{formatDate(property.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDate(property.updatedAt)}</p>
              </div>
            </div>

            {property.notes ? (
              <div className="border-t pt-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">
                  {property.notes}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-muted/20">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Units</CardTitle>
            <CardDescription>
              {property.unitCount === 0
                ? "No units have been added yet."
                : `${property.unitCount} unit${property.unitCount === 1 ? "" : "s"} in this property.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Manage rent, deposit and occupancy from the units module.
            </p>
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href={`/units?property=${property.id}`}>
                Open units
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
