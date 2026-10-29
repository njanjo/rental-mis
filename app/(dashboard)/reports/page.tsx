import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";

import { ColumnChart, ShareBars } from "@/components/charts/bar-chart";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAnyCapability } from "@/lib/auth/session";
import { ServiceError } from "@/lib/errors";
import { formatDate, formatMoney, formatMoneyCompact } from "@/lib/format";
import {
  arrearsAging,
  dashboardStats,
  incomeByChannel,
  incomeByMonth,
  incomeByProperty,
  parseReportWindow,
  type MonthPoint,
  type NamedBreakdown,
} from "@/services/reports";

export const metadata: Metadata = { title: "Reports" };

// Aggregations must always see the live ledger, never a cached render.
export const dynamic = "force-dynamic";

function csvHref(type: string, from: string, to: string): string {
  return `/api/reports/csv?type=${type}&from=${from}&to=${to}`;
}

/** Percent-of-total captions for breakdown lists. */
function shareCaptions(items: NamedBreakdown[]): string[] {
  const total = items.reduce((sum, item) => sum + Math.max(item.minor, 0), 0);
  if (total <= 0) return items.map(() => "100% of total");
  return items.map(
    (item) => `${Math.round((Math.max(item.minor, 0) / total) * 100)}% of total`,
  );
}

function occupancyPercent(occupied: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((occupied / total) * 100)}%`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireAnyCapability(["export_reports"]);

  const params = await searchParams;
  // Bad user-supplied dates fall back to the default window instead of an
  // error page; valid dates flow straight through.
  const foundParams =
    params.from || params.to
      ? (() => {
          try {
            return parseReportWindow(params.from, params.to);
          } catch (error) {
            if (error instanceof ServiceError) return null;
            throw error;
          }
        })()
      : null;
  const window = foundParams ?? parseReportWindow();

  const [stats, byMonth, byChannel, byProperty, aging] = await Promise.all([
    dashboardStats(user),
    incomeByMonth(user, window.from, window.to),
    incomeByChannel(user, window.from, window.to),
    incomeByProperty(user, window.from, window.to),
    arrearsAging(user),
  ]);

  const windowTotalMinor = byMonth.reduce(
    (total, point) => total + point.minor,
    0,
  );
  const channelCaptions = shareCaptions(byChannel);
  const propertyCaptions = shareCaptions(byProperty);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Income, arrears and occupancy across your portfolio. Every CSV export is audit logged."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={csvHref("payments", window.fromInput, window.toInput)}>
                <Download className="size-4" />
                Payments CSV
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={csvHref("arrears", window.fromInput, window.toInput)}>
                <Download className="size-4" />
                Arrears CSV
              </a>
            </Button>
          </>
        }
      />

      {/* Date range jump: a plain GET form keeps reports shareable by URL. */}
      <form action="/reports" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="report-from" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="report-from"
            type="date"
            name="from"
            defaultValue={window.fromInput}
            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="report-to" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="report-to"
            type="date"
            name="to"
            defaultValue={window.toInput}
            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" className="mb-0.5">
          Apply range
        </Button>
        <p className="mb-1.5 text-xs text-muted-foreground">
          {formatDate(window.from)} – {formatDate(window.toInput)}
        </p>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Collected in window"
          value={formatMoneyCompact(windowTotalMinor)}
          hint={`${formatMoney(windowTotalMinor)} net of reversals`}
        />
        <SummaryCard
          label="Outstanding arrears"
          value={formatMoneyCompact(stats.arrearsMinor)}
          hint={`${stats.arrearsInvoiceCount} open invoices · ${formatMoney(stats.arrearsMinor)}`}
          href="/invoices"
        />
        <SummaryCard
          label="Occupancy"
          value={occupancyPercent(stats.occupancy.occupied, stats.occupancy.total)}
          hint={`${stats.occupancy.occupied} of ${stats.occupancy.total} units occupied`}
          href="/units"
        />
        <SummaryCard
          label="Unmatched payments"
          value={String(stats.unmatchedCount)}
          hint="Awaiting review in the queue"
          href="/payments/unmatched"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Income by month</CardTitle>
            <CardDescription>
              Confirmed money received in the window, net of reversals.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ColumnChart
              points={byMonth.map((point: MonthPoint) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Income by channel</CardTitle>
            <CardDescription>M-Pesa vs bank vs manual receipts.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ShareBars
              points={byChannel.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: channelCaptions[index],
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Income by property</CardTitle>
            <CardDescription>Top properties in the window.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ShareBars
              points={byProperty.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: propertyCaptions[index],
              }))}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Arrears ageing</CardTitle>
            <CardDescription>
              Live invoice balances by how overdue they are, across all time
              (not just the window).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ShareBars
              points={aging.map((bucket) => ({
                label: bucket.label,
                minor: bucket.minor,
                sub: `${bucket.invoices} invoice${bucket.invoices === 1 ? "" : "s"}`,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  href?: string;
}) {
  const body = (
    <Card className="gap-2 py-4 h-full">
      <CardHeader className="px-4 pb-0">
        <CardDescription className="text-xs font-medium uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}
