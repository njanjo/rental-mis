import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  CreditCard,
  FileText,
  Receipt,
  Scale,
} from "lucide-react";

import { VoidInvoiceDialog } from "@/components/invoices/invoice-dialogs";
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
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getInvoice } from "@/services/invoices";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["view_financials"]);
  const { id } = await params;

  let invoice;
  try {
    invoice = await getInvoice(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const prorated =
    invoice.billableDays !== undefined &&
    invoice.periodDays !== undefined &&
    invoice.billableDays < invoice.periodDays;
  const canViewLeases = can(user.role, "manage_leases") || can(user.role, "view_financials");
  const canViewPortfolio =
    can(user.role, "manage_units") || can(user.role, "view_financials");

  return (
    <>
      <PageHeader
        title={`${invoice.periodLabel} invoice`}
        description={`${invoice.tenantName} · ${invoice.propertyName} · Unit ${invoice.unitNumber || "—"}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/invoices">Back</Link>
            </Button>
            {can(user.role, "manage_invoices") ? (
              <VoidInvoiceDialog invoice={invoice} />
            ) : null}
          </div>
        }
      />

      {invoice.storedStatus === "void" ? (
        <Card className="mb-4 border-slate-500/40 bg-slate-500/5">
          <CardContent className="py-3 text-sm">
            Voided {formatDateTime(invoice.voidedAt)}
            {invoice.voidReason ? `: ${invoice.voidReason}` : "."}
          </CardContent>
        </Card>
      ) : invoice.isOverdue ? (
        <Card className="mb-4 border-rose-500/40 bg-rose-500/5">
          <CardContent className="py-3 text-sm">
            This invoice passed its due date on {formatDate(invoice.dueDate)}.{" "}
            {formatMoney(invoice.balanceMinor)} is still outstanding.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <FileText className="size-3.5" /> Invoiced
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(invoice.amountDueMinor)}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CreditCard className="size-3.5" /> Paid
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(invoice.amountPaidMinor)}
            </p>
            {invoice.creditAppliedMinor > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(invoice.creditAppliedMinor)} from tenant credit
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Scale className="size-3.5" /> Balance
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(invoice.balanceMinor)}
            </p>
            <div className="mt-1">
              <StatusBadge status={invoice.status} />
            </div>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CalendarDays className="size-3.5" /> Due
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-sm font-medium">{formatDate(invoice.dueDate)}</p>
            <p className="text-xs text-muted-foreground">{invoice.periodLabel}</p>
          </CardContent>
        </Card>
      </div>

      {prorated ? (
        <Card className="mt-4 border-sky-500/30 bg-sky-500/5">
          <CardContent className="py-3 text-sm">
            Prorated rent: {invoice.billableDays} of {invoice.periodDays} days in{" "}
            {invoice.periodLabel}. The lease did not cover the whole month.
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="size-4" /> Payments applied
            </CardTitle>
            <CardDescription>
              Append-only allocations. Reversals create new ledger entries, never
              edits.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {invoice.allocations.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {invoice.creditAppliedMinor > 0
                  ? "Settled from tenant credit; no cash payments were allocated."
                  : "No payments have been allocated to this invoice."}
              </p>
            ) : (
              <ul className="divide-y">
                {invoice.allocations.map((allocation) => (
                  <li
                    key={allocation.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">
                        {allocation.provider} · {allocation.providerTransactionId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(allocation.receivedAt)}
                        {allocation.createdByName
                          ? ` · recorded by ${allocation.createdByName}`
                          : ""}
                      </p>
                    </div>
                    <p className="text-sm font-medium tabular-nums">
                      {formatMoney(allocation.amountMinor)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Where</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tenant
                </p>
                <Link
                  href={`/tenants/${invoice.tenantId}`}
                  className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {invoice.tenantName}
                  <ArrowRight className="size-3.5" />
                </Link>
                {invoice.tenantPhone ? (
                  <p className="text-xs text-muted-foreground">
                    {invoice.tenantPhone}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Lease
                </p>
                {canViewLeases ? (
                  <Link
                    href={`/leases/${invoice.leaseId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    View lease terms
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 font-medium">{invoice.leaseId}</p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Unit
                </p>
                {canViewPortfolio ? (
                  <Link
                    href={`/units/${invoice.unitId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {invoice.unitNumber}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 font-medium">{invoice.unitNumber}</p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </p>
                {canViewPortfolio ? (
                  <Link
                    href={`/properties/${invoice.propertyId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {invoice.propertyName}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 font-medium">{invoice.propertyName}</p>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                asChild
                className="w-full justify-between"
              >
                <Link href={`/invoices?period=${invoice.periodKey}`}>
                  All invoices this month
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
                  Issued
                </p>
                <p className="mt-1">{formatDateTime(invoice.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="mt-1">{formatDateTime(invoice.updatedAt)}</p>
              </div>
              {invoice.voidedAt ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Voided
                  </p>
                  <p className="mt-1">{formatDateTime(invoice.voidedAt)}</p>
                  {invoice.voidReason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {invoice.voidReason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
