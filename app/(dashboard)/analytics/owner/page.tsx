import type { Metadata } from "next";
import Link from "next/link";
import { Printer } from "lucide-react";

import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAnyCapability } from "@/lib/auth/session";
import { monthBounds, nairobiMonthKey, toDateInput } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, ownerMonthlyReport } from "@/services/reports";

export const metadata: Metadata = { title: "Owner report" };
export const dynamic = "force-dynamic";

function clampMonthKey(value?: string): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  return nairobiMonthKey(new Date());
}

export default async function OwnerAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireAnyCapability(["view_financials", "export_reports"]);
  const params = await searchParams;
  const monthKey = clampMonthKey(params.month);
  const report = await ownerMonthlyReport(user, monthKey);
  const bounds = monthBounds(monthKey);

  const totals = report.rows.reduce(
    (acc, row) => ({
      billedMinor: acc.billedMinor + row.billedMinor,
      collectedMinor: acc.collectedMinor + row.collectedMinor,
      arrearsMinor: acc.arrearsMinor + row.arrearsMinor,
      occupiedUnits: acc.occupiedUnits + row.occupiedUnits,
      totalUnits: acc.totalUnits + row.totalUnits,
    }),
    { billedMinor: 0, collectedMinor: 0, arrearsMinor: 0, occupiedUnits: 0, totalUnits: 0 },
  );

  return (
    <>
      <style>{`@media print {
        header, nav, aside, [data-sidebar], .no-print { display: none !important; }
        main { padding: 0 !important; max-width: none !important; }
        body { background: white !important; color: black !important; }
        .print-card { border: 1px solid #d1d5db !important; box-shadow: none !important; break-inside: avoid; }
      }`}</style>

      <PageHeader
        title="Owner monthly report"
        description={`Per-property performance for ${monthLabel(monthKey)} · print-first statement`}
        actions={
          <div className="no-print flex items-center gap-2">
            <form action="/analytics/owner" method="GET" className="flex items-center gap-2">
              <label htmlFor="owner-month" className="sr-only">Month</label>
              <input
                id="owner-month"
                type="month"
                name="month"
                defaultValue={monthKey}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              />
              <Button type="submit" variant="outline" size="sm">Apply</Button>
            </form>
            <Button variant="outline" size="sm" asChild>
              <a href="javascript:window.print()"><Printer className="size-4" />Print</a>
            </Button>
          </div>
        }
      />

      <SectionCard
        className="print-card"
        title={`Statement: ${monthLabel(monthKey)}`}
        description={`Billed and collected cover ${formatDate(bounds.start)} – ${formatDate(toDateInput(new Date(bounds.end.getTime() - 86_400_000)))}. Arrears and occupancy are live as of ${formatDateTime(new Date(report.asOf))} (not windowed).`}
      >
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Arrears (live)</TableHead>
                <TableHead className="text-right">Occupancy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.propertyId}>
                  <TableCell className="font-medium">{row.propertyName}</TableCell>
                  <TableCell className="text-right"><Money minor={row.billedMinor} /></TableCell>
                  <TableCell className="text-right"><Money minor={row.collectedMinor} /></TableCell>
                  <TableCell className="text-right"><Money minor={row.arrearsMinor} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.occupiedUnits}/{row.totalUnits}
                    {row.totalUnits > 0 ? ` (${Math.round((row.occupiedUnits / row.totalUnits) * 100)}%)` : ""}
                  </TableCell>
                </TableRow>
              ))}
              {report.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No property data in scope for this month.
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow className="bg-muted/20 font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right"><Money minor={totals.billedMinor} /></TableCell>
                  <TableCell className="text-right"><Money minor={totals.collectedMinor} /></TableCell>
                  <TableCell className="text-right"><Money minor={totals.arrearsMinor} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totals.occupiedUnits}/{totals.totalUnits}
                    {totals.totalUnits > 0 ? ` (${Math.round((totals.occupiedUnits / totals.totalUnits) * 100)}%)` : ""}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <p className="mt-3 text-xs text-muted-foreground">
        Collected is cash received in the month (receivedAt, net of reversals). Billed is invoice value for the month (periodKey). These bases differ by design — see <Link href="/analytics" className="underline underline-offset-2">Analytics</Link> for definitions.
      </p>
    </>
  );
}
