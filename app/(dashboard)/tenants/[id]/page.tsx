import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MessageSquare, Phone, UserRound } from "lucide-react";

import {
  EditTenantDialog,
  TenantStatusDialog,
} from "@/components/tenants/tenant-dialogs";
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
import { formatDate, formatPhone } from "@/lib/format";
import { getTenant } from "@/services/tenants";

export const metadata: Metadata = { title: "Tenant" };

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["manage_tenants", "view_financials"]);
  const { id } = await params;

  let tenant;
  try {
    tenant = await getTenant(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const canManage = can(user.role, "manage_tenants");

  return (
    <>
      <PageHeader
        title={tenant.fullName}
        description={`Tenant since ${formatDate(tenant.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tenants">Back</Link>
            </Button>
            {canManage ? (
              <>
                <EditTenantDialog tenant={tenant} />
                <TenantStatusDialog tenant={tenant} />
              </>
            ) : null}
          </div>
        }
      />

      {tenant.status !== "active" ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            This tenant is marked {tenant.status}. They remain on record so their
            payment history is preserved.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Phone className="size-3.5" /> Phone
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-base font-semibold tabular-nums">
              {formatPhone(tenant.phoneE164)}
            </p>
            <p className="text-xs text-muted-foreground">Used for M-Pesa matching</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <UserRound className="size-3.5" /> Status
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <StatusBadge status={tenant.status} />
            <p className="mt-1 text-xs text-muted-foreground">Tenant record</p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <MessageSquare className="size-3.5" /> SMS consent
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-base font-semibold">
              {tenant.consentSms ? "Opted in" : "Opted out"}
            </p>
            <p className="text-xs text-muted-foreground">
              {tenant.consentSms
                ? "Rent reminders and receipts are allowed."
                : "No SMS may be sent to this tenant."}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="text-xs uppercase tracking-wide">
              Current unit
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {tenant.currentUnitId ? (
              <Link
                href={`/units/${tenant.currentUnitId}`}
                className="text-base font-semibold hover:underline"
              >
                {tenant.unitNumber ?? "Unit"}
              </Link>
            ) : (
              <p className="text-base font-semibold">Not leased</p>
            )}
            <p className="text-xs text-muted-foreground">
              {tenant.propertyName ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Tenant record</CardTitle>
            <CardDescription>
              Contact details and the properties this tenant is associated with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Full name
                </p>
                <p className="mt-1">{tenant.fullName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  National ID
                </p>
                <p className="mt-1">
                  {tenant.nationalIdLast4
                    ? `•••• ${tenant.nationalIdLast4}`
                    : "Not recorded"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Properties
                </p>
                <p className="mt-1">
                  {tenant.propertyNames.length > 0
                    ? tenant.propertyNames.join(", ")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDate(tenant.updatedAt)}</p>
              </div>
            </div>

            {tenant.notes ? (
              <div className="border-t pt-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">
                  {tenant.notes}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-muted/20">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Current tenancy</CardTitle>
            <CardDescription>
              {tenant.currentLeaseId
                ? "Backed by an active lease."
                : "This tenant has no active lease."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            {tenant.currentLeaseId ? (
              <>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Lease
                  </p>
                  <Link
                    href={`/leases/${tenant.currentLeaseId}`}
                    className="mt-1 inline-flex items-center gap-1 hover:underline"
                  >
                    Open lease
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
                {tenant.currentPropertyId ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Property
                    </p>
                    <Link
                      href={`/properties/${tenant.currentPropertyId}`}
                      className="mt-1 inline-flex items-center gap-1 hover:underline"
                    >
                      {tenant.propertyName ?? tenant.currentPropertyId}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Unit
                  </p>
                  {tenant.currentUnitId ? (
                    <Link
                      href={`/units/${tenant.currentUnitId}`}
                      className="mt-1 inline-flex items-center gap-1 hover:underline"
                    >
                      {tenant.unitNumber ?? tenant.currentUnitId}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ) : (
                    <p className="mt-1">—</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                Start a lease from the leases module to place this tenant in a
                unit. Status changes are blocked while a lease is active.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
