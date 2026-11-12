import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Building2,
  CircleAlert,
  CircleDashed,
  Percent,
} from "lucide-react";

import { ColumnChart, ShareBars } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { PointsTable, ShareTable } from "@/components/charts/series-table";
import { Sparkline } from "@/components/charts/sparkline";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Stat } from "@/components/shared/stat";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { defaultLandingPath } from "@/lib/auth/landing";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { change, getMetric } from "@/lib/metrics/catalog";
import { ROLE_LABELS } from "@/lib/types";
import {
  arrearsAging,
  attentionQueue,
  collectedMtdComparison,
  collectionTrend,
  dashboardStats,
} from "@/services/reports";

export const metadata: Metadata = {
  title: "Dashboard",
};

// KPIs come from the live ledger; render fresh on every visit.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role === "maintenance") {
    redirect(defaultLandingPath(user.role));
  }
  if (!["admin", "property_manager", "finance", "auditor"].includes(user.role)) {
    redirect(defaultLandingPath(user.role));
  }

  // Aggregations share one render; the interval refresh keeps them current.
  const [stats, trend, aging, attention, collectedCompare] = await Promise.all([
    dashboardStats(user),
    collectionTrend(user),
    arrearsAging(user),
    attentionQueue(user),
    collectedMtdComparison(user),
  ]);

  const occupancy =
    stats.occupancy.total === 0
      ? "—"
      : `${Math.round(
          (stats.occupancy.occupied / stats.occupancy.total) * 100,
        )}%`;

  const collectedDelta = change(
    collectedCompare.currentMinor,
    collectedCompare.previousMinor,
    { higherIsBetter: getMetric("collected").higherIsBetter },
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${ROLE_LABELS[user.role]} · ${formatDate(new Date())} · as of ${formatDateTime(new Date())}`}
        actions={
          <>
            <AutoRefresh seconds={60} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/properties">
                <Building2 className="size-4" />
                Properties
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Occupancy"
          value={occupancy}
          hint={`${stats.occupancy.occupied} of ${stats.occupancy.total} units occupied`}
          icon={Percent}
          href="/units"
        />
        <Stat
          label="Collected this month"
          value={<Money minor={stats.collectedThisMonthMinor} compact />}
          hint={`${formatMoney(stats.collectedThisMonthMinor)} net · month to date · ${collectedCompare.basisLabel}`}
          icon={Banknote}
          delta={collectedDelta}
          sparkline={
            <Sparkline
              points={trend.map((point) => point.minor)}
              label="Collections, last six months"
            />
          }
        />
        <Stat
          label="Outstanding arrears"
          value={<Money minor={stats.arrearsMinor} compact />}
          hint={`${stats.arrearsInvoiceCount} open invoices · as of today`}
          icon={CircleAlert}
          href="/invoices"
        />
        <Stat
          label="Unmatched payments"
          value={String(stats.unmatchedCount)}
          hint="Review queue · not counted as collected"
          icon={CircleDashed}
          href="/payments/unmatched"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <SectionCard
          className="lg:col-span-2 lg:row-span-2"
          title="Attention queue"
          description="Items that need action now, scoped to your portfolio."
        >
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No urgent items. Arrears, unmatched payments, lease expiries and
              overdue maintenance are all clear.
            </p>
          ) : (
            <ul className="space-y-2">
              {attention.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    {item.minor !== undefined ? (
                      <Money minor={item.minor} compact className="shrink-0 text-sm font-semibold" />
                    ) : item.count !== undefined ? (
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                        {item.count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <ChartFrame
          className="lg:col-span-3"
          title="Collections — last 6 months"
          description="Confirmed money received per Nairobi month, net of reversals."
          footer="Basis: receivedAt · unconfirmed M-Pesa is excluded."
          chart={
            <ColumnChart
              points={trend.map((point) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          }
          table={
            <PointsTable
              rows={trend.map((point) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          }
        />

        <ChartFrame
          className="lg:col-span-3"
          title="Arrears ageing"
          description="Live balances by days past due."
          footer="As of today · ignores any reporting window."
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

      <Card className="mt-4 border-dashed bg-muted/20">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Deep dives live in Analytics</p>
            <p className="text-sm text-muted-foreground">
              Income by property and channel, arrears ageing and audit-logged
              CSV exports with a date range of your choice.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href="/analytics">
              Open analytics
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
