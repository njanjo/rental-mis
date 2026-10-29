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
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { defaultLandingPath } from "@/lib/auth/landing";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatMoney, formatMoneyCompact } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";
import {
  arrearsAging,
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
  const [stats, trend, aging] = await Promise.all([
    dashboardStats(user),
    collectionTrend(user),
    arrearsAging(user),
  ]);

  const occupancy =
    stats.occupancy.total === 0
      ? "—"
      : `${Math.round(
          (stats.occupancy.occupied / stats.occupancy.total) * 100,
        )}%`;

  const kpis = [
    {
      label: "Occupancy",
      value: occupancy,
      hint: `${stats.occupancy.occupied} of ${stats.occupancy.total} units occupied`,
      icon: Percent,
    },
    {
      label: "Collected this month",
      value: formatMoneyCompact(stats.collectedThisMonthMinor),
      hint: `${formatMoney(stats.collectedThisMonthMinor)} net of reversals`,
      icon: Banknote,
    },
    {
      label: "Outstanding arrears",
      value: formatMoneyCompact(stats.arrearsMinor),
      hint: `${stats.arrearsInvoiceCount} open invoices`,
      icon: CircleAlert,
    },
    {
      label: "Unmatched payments",
      value: String(stats.unmatchedCount),
      hint: "Review queue",
      icon: CircleDashed,
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${ROLE_LABELS[user.role]} · ${formatDate(new Date())}`}
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
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const card = (
            <Card key={kpi.label} className="gap-2 py-4 h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-0">
                <CardDescription className="text-xs font-medium uppercase tracking-wide">
                  {kpi.label}
                </CardDescription>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-2xl font-semibold tabular-nums tracking-tight">
                  {kpi.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
              </CardContent>
            </Card>
          );
          // The review queue count doubles as a shortcut; the rest stay static.
          return kpi.label === "Unmatched payments" ? (
            <Link key={kpi.label} href="/payments/unmatched">
              {card}
            </Link>
          ) : (
            card
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Collections — last 6 months</CardTitle>
            <CardDescription>
              Confirmed money received per Nairobi month, net of reversals.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <ColumnChart
              points={trend.map((point) => ({
                label: point.label,
                minor: point.minor,
              }))}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Arrears ageing</CardTitle>
            <CardDescription>Live balances by days past due</CardDescription>
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

      <Card className="mt-4 border-dashed bg-muted/20">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Deep dives live in Reports
            </p>
            <p className="text-sm text-muted-foreground">
              Income by property and channel, arrears ageing and audit-logged
              CSV exports with a date range of your choice.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href="/reports">
              Open reports
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
