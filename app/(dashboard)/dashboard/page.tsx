import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Building2,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Percent,
  ShieldCheck,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";

export const metadata: Metadata = {
  title: "Dashboard",
};

const kpis = [
  {
    label: "Occupancy",
    value: "—",
    hint: "Calculated from active leases",
    icon: Percent,
  },
  {
    label: "Collected this month",
    value: "—",
    hint: "M-Pesa + bank, after reconciliation",
    icon: Banknote,
  },
  {
    label: "Outstanding arrears",
    value: "—",
    hint: "Sum of invoice balances",
    icon: CircleAlert,
  },
  {
    label: "Unmatched payments",
    value: "0",
    hint: "Review queue",
    icon: CircleDashed,
  },
];

const foundationChecks = [
  { label: "Session cookie auth with revocation check", done: true },
  { label: "Role capability matrix (5 roles)", done: true },
  { label: "Firestore security rules + composite indexes", done: true },
  { label: "Typed data model for all 16 collections", done: true },
  { label: "Emulator seed + rules test suite", done: true },
  { label: "Payment reconciliation engine", done: false },
];

const phases = [
  { phase: "3", name: "Operations", detail: "Properties, units, tenants, leases, maintenance" },
  { phase: "4", name: "Billing", detail: "Invoices, allocations, arrears, ledger" },
  { phase: "5", name: "Payments", detail: "M-Pesa + bank adapters, unmatched queue" },
  { phase: "6", name: "Automation", detail: "Beam SMS outbox, reminders, scheduled jobs" },
  { phase: "7", name: "Reporting", detail: "Realtime dashboard, charts, CSV exports" },
];

export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role === "maintenance") {
    redirect(defaultLandingPath(user.role));
  }

  const scope =
    user.role === "admin"
      ? "All properties"
      : `${user.propertyIds.length} assigned propert${
          user.propertyIds.length === 1 ? "y" : "ies"
        }`;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${ROLE_LABELS[user.role]} · ${scope} · ${formatDate(new Date())}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/properties">
              <Building2 className="size-4" />
              Properties
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="gap-2 py-4">
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
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                <CardTitle className="text-base">Foundation status</CardTitle>
              </div>
              <Badge variant="secondary" className="font-normal">
                Phase 2
              </Badge>
            </div>
            <CardDescription>
              Plumbing verified before any financial logic is written.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {foundationChecks.map((check) => (
                <li key={check.label} className="flex items-start gap-2 text-sm">
                  {check.done ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={check.done ? "" : "text-muted-foreground"}>
                    {check.label}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Next up</CardTitle>
            <CardDescription>Delivery order from the specification</CardDescription>
          </CardHeader>
          <CardContent className="divide-y px-0">
            {phases.map((item) => (
              <div
                key={item.phase}
                className="flex items-start gap-3 px-4 py-2.5 first:pt-1 last:pb-0"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {item.phase}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 border-dashed bg-muted/20">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">No tenant portal, by design</p>
            <p className="text-sm text-muted-foreground">
              Tenants receive SMS and pay by M-Pesa or bank. Staff manage
              everything from this dashboard.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href="/payments">
              Payment ledger
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
