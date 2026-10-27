import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CreditCard,
  Inbox,
  ReceiptText,
  Scale,
  Wallet,
} from "lucide-react";

import { ReversePaymentDialog } from "@/components/payments/payment-dialogs";
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
import type { PaymentSource } from "@/lib/types";
import { getPayment } from "@/services/payments";

export const metadata: Metadata = { title: "Payment" };

const SOURCE_LABELS: Record<PaymentSource, string> = {
  callback: "Provider callback",
  poll: "Provider poll",
  statement: "Bank statement",
  manual: "Entered by staff",
};

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyCapability(["view_financials"]);
  const { id } = await params;

  let payment;
  try {
    payment = await getPayment(user, id);
  } catch (error) {
    if (
      isServiceError(error) &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      notFound();
    }
    throw error;
  }

  const isReversal = payment.status === "reversal" || Boolean(payment.reversalOfPaymentId);
  const canReverse =
    can(user.role, "approve_reversals") &&
    !isReversal &&
    payment.status !== "reversed" &&
    payment.status !== "unmatched" &&
    payment.status !== "rejected" &&
    !payment.reversalPaymentId &&
    (payment.allocatedMinor > 0 || payment.creditAddedMinor > 0);

  const canViewLeases =
    can(user.role, "manage_leases") || can(user.role, "view_financials");
  const canViewPortfolio =
    can(user.role, "manage_units") || can(user.role, "view_financials");

  return (
    <>
      <PageHeader
        title={`${payment.provider === "mpesa" ? "M-Pesa" : payment.provider === "bank" ? "Bank" : "Cash"} payment`}
        description={`${payment.providerTransactionId} · ${payment.tenantName ?? payment.payerName ?? "Unmatched"}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/payments">Back</Link>
            </Button>
            {canReverse ? <ReversePaymentDialog payment={payment} /> : null}
          </div>
        }
      />

      {payment.status === "reversal" ? (
        <Card className="mb-4 border-rose-500/40 bg-rose-500/5">
          <CardContent className="py-3 text-sm">
            Reversal entry for{" "}
            {payment.reversalOfPaymentId ? (
              <Link
                href={`/payments/${payment.reversalOfPaymentId}`}
                className="font-medium hover:underline"
              >
                the original payment
              </Link>
            ) : (
              "an earlier payment"
            )}
            . {payment.reversalReason ?? "No reason recorded."}
          </CardContent>
        </Card>
      ) : payment.status === "reversed" ? (
        <Card className="mb-4 border-rose-500/40 bg-rose-500/5">
          <CardContent className="space-y-1 py-3 text-sm">
            <p>
              Reversed on {formatDateTime(payment.reversedAt)}
              {payment.reversedByName ? ` by ${payment.reversedByName}` : ""}.
            </p>
            <p className="text-muted-foreground">
              {payment.reversalReason ?? "No reason recorded."}
            </p>
            {payment.reversalPaymentId ? (
              <Link
                href={`/payments/${payment.reversalPaymentId}`}
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                View the compensating entry
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : payment.status === "unmatched" ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span>
              This payment has not been matched to a tenant yet. Nothing has been
              allocated.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href="/payments/unmatched">
                <Inbox className="size-4" />
                Unmatched queue
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Banknote className="size-3.5" /> Amount
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p
              className={
                payment.amountMinor < 0
                  ? "text-xl font-semibold tabular-nums text-rose-600"
                  : "text-xl font-semibold tabular-nums"
              }
            >
              {formatMoney(payment.amountMinor)}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <CreditCard className="size-3.5" /> Allocated
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(payment.allocatedMinor)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {payment.allocations.length} invoice
              {payment.allocations.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Wallet className="size-3.5" /> To credit
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(payment.creditAddedMinor)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Surplus held for future invoices
            </p>
          </CardContent>
        </Card>

        <Card className="gap-1 py-4">
          <CardHeader className="px-4 pb-0">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Scale className="size-3.5" /> Status
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={payment.status} />
              <p className="text-xs text-muted-foreground">
                {SOURCE_LABELS[payment.source]}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="size-4" /> Allocation ledger
            </CardTitle>
            <CardDescription>
              Append-only. Reversals add compensating rows instead of editing
              history.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {payment.allocations.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {payment.status === "unmatched"
                  ? "Nothing allocated until this payment is matched."
                  : "No invoice allocations were needed."}
              </p>
            ) : (
              <ul className="divide-y">
                {payment.allocations.map((allocation) => (
                  <li
                    key={allocation.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      {allocation.periodKey ? (
                        <Link
                          href={`/invoices/${allocation.invoiceId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {allocation.periodLabel}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium">
                          {allocation.invoiceId}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {allocation.dueDate
                          ? `Due ${formatDate(allocation.dueDate)} · `
                          : ""}
                        {allocation.invoiceId}
                      </p>
                    </div>
                    <p
                      className={
                        allocation.amountMinor < 0
                          ? "text-sm font-medium tabular-nums text-rose-600"
                          : "text-sm font-medium tabular-nums"
                      }
                    >
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
              <CardTitle className="text-base">Who and where</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tenant
                </p>
                {payment.tenantId ? (
                  <Link
                    href={`/tenants/${payment.tenantId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {payment.tenantName ?? payment.tenantId}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1 text-muted-foreground">Not matched</p>
                )}
                {payment.tenantPhone ? (
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(payment.tenantPhone)}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Payer
                </p>
                <p className="mt-1">{payment.payerName ?? "—"}</p>
                {payment.payerPhone ? (
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(payment.payerPhone)}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </p>
                {payment.propertyId && canViewPortfolio ? (
                  <Link
                    href={`/properties/${payment.propertyId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {payment.propertyName ?? payment.propertyId}
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1">
                    {payment.propertyName ?? "Not matched"}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Lease
                </p>
                {payment.leaseId && canViewLeases ? (
                  <Link
                    href={`/leases/${payment.leaseId}`}
                    className="mt-1 inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    View lease terms
                    <ArrowRight className="size-3.5" />
                  </Link>
                ) : (
                  <p className="mt-1">{payment.leaseId ?? "—"}</p>
                )}
              </div>

              {payment.bankCode ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Bank code
                  </p>
                  <p className="mt-1">{payment.bankCode}</p>
                </div>
              ) : null}

              {payment.narration ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Narration
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {payment.narration}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-muted/20">
            <CardHeader className="border-b">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Received
                </p>
                <p className="mt-1 flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 text-muted-foreground" />
                  {formatDateTime(payment.receivedAt)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Confirmed
                </p>
                <p className="mt-1">
                  {formatDateTime(payment.confirmedAt)}
                  {payment.confirmedByName
                    ? ` · ${payment.confirmedByName}`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Recorded
                </p>
                <p className="mt-1">{formatDateTime(payment.createdAt)}</p>
              </div>
              {payment.reversedAt ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Reversed
                  </p>
                  <p className="mt-1">
                    {formatDateTime(payment.reversedAt)}
                    {payment.reversedByName
                      ? ` · ${payment.reversedByName}`
                      : ""}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
