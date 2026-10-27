import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, Receipt, UserRound, Wallet } from "lucide-react";

import {
  ArchiveUnitButton,
  EditUnitDialog,
  RestoreUnitButton,
} from "@/components/units/unit-dialogs";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDate, formatMoney, formatPhone } from "@/lib/format";
import { getUnit, getUnitLeaseHistory } from "@/services/units";

export const metadata: Metadata = { title: "Unit" };

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["manage_units", "view_financials"]);
  const { id } = await params;

  let unit;
  try {
    unit = await getUnit(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const history = await getUnitLeaseHistory(user, unit.id);
  const canManage = can(user.role, "manage_units");
  const isOccupied = Boolean(unit.activeLeaseId);

  return (
    <>
      <PageHeader
        title={`${unit.propertyName} · ${unit.unitNumber}`}
        description="Rent, deposit, occupancy and this unit's lease history."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/units">Back</Link>
            </Button>
            {canManage ? (
              <>
                <EditUnitDialog unit={unit} isOccupied={isOccupied} />
                {unit.active ? (
                  <ArchiveUnitButton unit={unit} />
                ) : (
                  <RestoreUnitButton unit={unit} />
                )}
              </>
            ) : null}
          </div>
        }
      />

      {!unit.active ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            This unit is archived{unit.archiveReason ? `: ${unit.archiveReason}` : ""}.
            Its history is preserved, but it cannot be let until restored.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Wallet className="size-3.5" /> Monthly rent
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(unit.rentAmountMinor)}
            </p>
            <p className="text-xs text-muted-foreground">Asking rent</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Receipt className="size-3.5" /> Deposit
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(unit.depositAmountMinor)}
            </p>
            <p className="text-xs text-muted-foreground">Refundable</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="text-xs uppercase tracking-wide">
              Occupancy
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <StatusBadge status={unit.active ? unit.status : "archived"} />
            <p className="mt-1 text-xs text-muted-foreground">
              Set by the active lease
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <UserRound className="size-3.5" /> Current tenant
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {unit.activeTenantId && unit.tenantName ? (
              <Link
                href={`/tenants/${unit.activeTenantId}`}
                className="text-sm font-medium hover:underline"
              >
                {unit.tenantName}
              </Link>
            ) : (
              <p className="text-sm font-medium">Vacant</p>
            )}
            <p className="text-xs text-muted-foreground">
              {unit.tenantPhone ? formatPhone(unit.tenantPhone) : "No tenant"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Lease history</CardTitle>
              <span className="text-xs text-muted-foreground">
                {history.length} record{history.length === 1 ? "" : "s"}
              </span>
            </div>
            <CardDescription>
              Every lease ever signed for this unit, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No leases yet. Start one from the leases module.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Tenant</TableHead>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Rent</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((lease) => (
                    <TableRow key={lease.id}>
                      <TableCell className="text-sm">
                        <Link
                          href={`/tenants/${lease.tenantId}`}
                          className="hover:underline"
                        >
                          {lease.tenantName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(lease.startDate)} → {formatDate(lease.endDate)}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {formatMoney(lease.rentAmountMinor)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={lease.status} />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/leases/${lease.id}`}
                          aria-label={`Open lease for ${lease.tenantName}`}
                          className="flex justify-end text-muted-foreground hover:text-foreground"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Unit details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </p>
                <Link
                  href={`/properties/${unit.propertyId}`}
                  className="mt-1 inline-flex items-center gap-1 hover:underline"
                >
                  {unit.propertyName}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="mt-1">{formatDate(unit.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDate(unit.updatedAt)}</p>
              </div>
              {unit.notes ? (
                <div className="border-t pt-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">
                    {unit.notes}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Tenants in this property</CardTitle>
              <CardDescription>
                Filter the tenant list to the property this unit belongs to.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link href={`/tenants?property=${unit.propertyId}`}>
                  Open tenants
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
