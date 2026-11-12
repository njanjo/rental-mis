import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";

import { ColumnChart, ShareBars } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { PointsTable, ShareTable } from "@/components/charts/series-table";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { Button } from "@/components/ui/button";
import { requireAnyCapability } from "@/lib/auth/session";
import {
  monthBounds,
  nairobiMonthKey,
  parseDateInput,
  toDateInput,
  todayIsoDate,
} from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { formatDate, formatMoney, formatDateTime } from "@/lib/format";
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

export const metadata: Metadata = { title: "Analytics" };

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

function shiftDays(iso: string, days: number): string {
  const date = parseDateInput(iso);
  if (!date) return iso;
  return toDateInput(new Date(date.getTime() + days * 86_400_000));
}

/** Shareable URL range pills — no client JS, works with the back button. */
function rangePresets(today: string) {
  const parsed = parseDateInput(today);
  const currentKey = nairobiMonthKey(parsed ?? new Date());
  const currentStart = monthBounds(currentKey).start;
  const lastEnd = new Date(currentStart.getTime() - 86_400_000);
  const lastStart = monthBounds(nairobiMonthKey(lastEnd)).start;

  return [
    { label: "This month", from: `${currentKey}-01`, to: today },
    { label: "Last month", from: toDateInput(lastStart), to: toDateInput(lastEnd) },
    { label: "Last 90 days", from: shiftDays(today, -89), to: today },
    { label: "Year to date", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

export default async function AnalyticsPage({
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

  const presets = rangePresets(todayIsoDate());
  const activePreset = presets.find(
    (preset) => preset.from === window.fromInput && preset.to === window.toInput,
  )?.label;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Income, arrears and occupancy across your portfolio · updated ${formatDateTime(new Date())} Africa/Nairobi`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/analytics/owner">Owner monthly report</Link>
            </Button>
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

      {/* Range presets are plain links so the URL stays shareable and the
          back button behaves; the date form covers custom windows. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const active =
            preset.from === window.fromInput && preset.to === window.toInput;
          return (
            <Button
              key={preset.label}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="h-8"
              asChild
            >
              <Link
                href={`/analytics?from=${preset.from}&to=${preset.to}`}
                aria-current={active ? "true" : undefined}
              >
                {preset.label}
              </Link>
            </Button>
          );
        })}
        <span className="ml-1 text-xs text-muted-foreground">
          {activePreset ? `Showing ${activePreset.toLowerCase()}` : "Custom range"}
        </span>
      </div>

      {/* Custom range: a plain GET form keeps reports shareable by URL. */}
      <form action="/analytics" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
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
        <Stat
          label="Collected in window"
          value={<Money minor={windowTotalMinor} compact />}
          hint={`${formatMoney(windowTotalMinor)} net of reversals`}
        />
        <Stat
          label="Outstanding arrears"
          value={<Money minor={stats.arrearsMinor} compact />}
          hint={`${stats.arrearsInvoiceCount} open invoices · as of today`}
          href="/invoices"
        />
        <Stat
          label="Occupancy"
          value={occupancyPercent(stats.occupancy.occupied, stats.occupancy.total)}
          hint={`${stats.occupancy.occupied} of ${stats.occupancy.total} units occupied`}
          href="/units"
        />
        <Stat
          label="Unmatched payments"
          value={String(stats.unmatchedCount)}
          hint="Awaiting review · not counted as collected"
          href="/payments/unmatched"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartFrame
          className="lg:col-span-2"
          title="Income by month"
          description="Confirmed money received in the window, net of reversals."
          footer="Basis: receivedAt · unconfirmed M-Pesa is excluded."
          chart={
            <ColumnChart
              points={byMonth.map((point: MonthPoint) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          }
          table={
            <PointsTable
              rows={byMonth.map((point: MonthPoint) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          }
        />

        <ChartFrame
          title="Income by channel"
          description="M-Pesa vs bank vs manual receipts."
          footer="Share of confirmed money in the window."
          chart={
            <ShareBars
              points={byChannel.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: channelCaptions[index],
              }))}
            />
          }
          table={
            <ShareTable
              rows={byChannel.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: channelCaptions[index],
              }))}
            />
          }
        />

        <ChartFrame
          title="Income by property"
          description="Top properties in the window."
          footer="Unmatched money is grouped, never guessed onto a property."
          chart={
            <ShareBars
              points={byProperty.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: propertyCaptions[index],
              }))}
            />
          }
          table={
            <ShareTable
              rows={byProperty.map((item, index) => ({
                label: item.label,
                minor: item.minor,
                sub: propertyCaptions[index],
              }))}
            />
          }
        />

        <ChartFrame
          className="lg:col-span-2"
          title="Arrears ageing"
          description="Live invoice balances by how overdue they are, across all time (not just the window)."
          footer="As of today · ignores the selected window."
          chart={
            <ShareBars
              points={aging.map((bucket) => ({
                label: bucket.label,
                minor: bucket.minor,
                sub: `${bucket.invoices} invoice${bucket.invoices === 1 ? "" : "s"}`,
              }))}
            />
          }
          table={
            <ShareTable
              rows={aging.map((bucket) => ({
                label: bucket.label,
                minor: bucket.minor,
                sub: `${bucket.invoices} invoice${bucket.invoices === 1 ? "" : "s"}`,
              }))}
            />
          }
        />
      </div>
    </>
  );
}
