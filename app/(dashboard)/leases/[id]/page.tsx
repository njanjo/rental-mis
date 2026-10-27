import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  CalendarClock,
  CircleDollarSign,
  ScrollText,
  Wallet,
} from "lucide-react";

import {
  ActivateLeaseButton,
  EditLeaseTermsDialog,
  RenewLeaseDialog,
  TerminateLeaseButton,
} from "@/components/leases/lease-dialogs";
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
import { formatDate, formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { getLease } from "@/services/leases";

export const metadata: Metadata = { title: "Lease" };

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["manage_leases", "view_financials"]);
  const { id } = await params;

  let lease;
  try {
    lease = await getLease(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const canManage = can(user.role, "manage_leases");
  const isOpen = lease.status === "pending" || lease.status === "active";

  return (
    <>
      <PageHeader
        title={`${lease.tenantName} · ${lease.unitNumber}`}
        description={`${lease.propertyName} · ${lease.status === "pending" ? "not yet in occupation" : `lease ${lease.status}`}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/leases">Back</Link>
            </Button>
            {canManage && isOpen ? (
              <>
                {lease.status === "pending" ? (
                  <ActivateLeaseButton lease={lease} />
                ) : null}
                <EditLeaseTermsDialog lease={lease} />
                {lease.status === "active" ? (
                  <RenewLeaseDialog lease={lease} />
                ) : null}
                <TerminateLeaseButton lease={lease} />
              </>
            ) : null}
          </div>
        }
      />

      {lease.status === "pending" ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            This lease is pending. The unit stays vacant and the tenant keeps any
            existing tenancy until it is activated on the move-in date.
          </CardContent>
        </Card>
      ) : null}

      {lease.status === "terminated" ? (
        <Card className="mb-4 border-rose-500/40 bg-rose-500/5">
          <CardContent className="py-3 text-sm">
            Terminated {formatDate(lease.terminatedAt)}
            {lease.terminationReason ? `: ${lease.terminationReason}` : "."}
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
              {formatMoney(lease.rentAmountMinor)}
            </p>
            <p className="text-xs text-muted-foreground">Agreed rent</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CircleDollarSign className="size-3.5" /> Deposit
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(lease.depositAmountMinor)}
            </p>
            <p className="text-xs text-muted-foreground">Held on account</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CalendarClock className="size-3.5" /> Rent due day
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">{lease.dueDay}</p>
            <p className="text-xs text-muted-foreground">Of each month</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="text-xs uppercase tracking-wide">
              Status
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <StatusBadge status={lease.status} />
            <p className="mt-1 text-xs text-muted-foreground">
              {lease.status === "active"
                ? "Unit occupied"
                : lease.status === "pending"
                  ? "Awaiting activation"
                  : "Closed term"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Lease terms</CardTitle>
            <CardDescription>
              Dates, parties and the property this tenancy belongs to.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tenant
                </p>
                <Link
                  href={`/tenants/${lease.tenantId}`}
                  className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {lease.tenantName}
                  <ArrowRight className="size-3.5" />
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatPhone(lease.tenantPhone)}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Unit
                </p>
                <Link
                  href={`/units/${lease.unitId}`}
                  className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {lease.unitNumber}
                  <ArrowRight className="size-3.5" />
                </Link>
                <p className="text-xs text-muted-foreground">
                  {lease.propertyName}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </p>
                <Link
                  href={`/properties/${lease.propertyId}`}
                  className="mt-1 inline-flex items-center gap-1 hover:underline"
                >
                  {lease.propertyName}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Period
                </p>
                <p className="mt-1 flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                  {formatDate(lease.startDate)} → {formatDate(lease.endDate)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="mt-1">{formatDateTime(lease.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDateTime(lease.updatedAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Renewal</CardTitle>
              <CardDescription>
                {lease.renewedFromLeaseId
                  ? "This lease replaces an earlier term."
                  : lease.renewedToLeaseId
                    ? "A renewal has been drafted for this tenancy."
                    : "No renewal is linked to this lease."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              {lease.renewedFromLeaseId ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Renewed from
                  </p>
                  <Link
                    href={`/leases/${lease.renewedFromLeaseId}`}
                    className="mt-1 inline-flex items-center gap-1 hover:underline"
                  >
                    Previous lease
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ) : null}

              {lease.renewedToLeaseId ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Renewed by
                  </p>
                  <Link
                    href={`/leases/${lease.renewedToLeaseId}`}
                    className="mt-1 inline-flex items-center gap-1 hover:underline"
                  >
                    Renewal lease
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ) : null}

              {!lease.renewedFromLeaseId && !lease.renewedToLeaseId ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <ScrollText className="size-4" />
                  Renewals appear here once one is drafted.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Related records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-4 text-sm">
              <Button variant="outline" size="sm" asChild className="w-full justify-between">
                <Link href={`/tenants/${lease.tenantId}`}>
                  Tenant profile
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="w-full justify-between">
                <Link href={`/units/${lease.unitId}`}>
                  Unit history
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="w-full justify-between">
                <Link href={`/leases?property=${lease.propertyId}`}>
                  Leases in this property
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
