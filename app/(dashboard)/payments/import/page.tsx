import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { BankImportWizard } from "@/components/payments/bank-import-wizard";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import {
  BANK_COLUMN_KEYS,
  BANK_COLUMN_LABELS,
  BANK_DATE_FORMAT_LABELS,
  BANK_DATE_FORMATS,
  KENYAN_BANKS,
  REQUIRED_BANK_COLUMNS,
} from "@/lib/bank-import";
import { isServiceError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { listRecentBankImports } from "@/services/bank-import";

export const metadata: Metadata = { title: "Import bank statement" };

export default async function BankImportPage() {
  const user = await requireAnyCapability([
    "enter_manual_receipts",
    "reconcile_payments",
  ]);

  if (!can(user.role, "enter_manual_receipts") || !can(user.role, "reconcile_payments")) {
    redirect("/payments");
  }

  const runs = await listRecentBankImports(user, 8).catch((error) => {
    if (isServiceError(error) && error.code === "forbidden") return [];
    throw error;
  });

  return (
    <>
      <PageHeader
        title="Import bank statement"
        description="Bring a CSV export into the payments ledger. Matches are made by the payer's phone number only; anything uncertain goes to the unmatched queue."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/payments">
              <ChevronLeft className="size-4" />
              All payments
            </Link>
          </Button>
        }
      />

      <BankImportWizard
        banks={KENYAN_BANKS}
        columns={BANK_COLUMN_KEYS.map((key) => ({
          key,
          label: BANK_COLUMN_LABELS[key],
          required: REQUIRED_BANK_COLUMNS.includes(key),
        }))}
        dateFormats={BANK_DATE_FORMATS.map((value) => ({
          value,
          label: BANK_DATE_FORMAT_LABELS[value],
        }))}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
          <CardDescription>
            Every file leaves a run record with its counts, so an import can be
            audited without re-reading the CSV.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No statement has been imported yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Started</th>
                    <th className="p-2 font-medium">Bank</th>
                    <th className="p-2 font-medium">File</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 text-right font-medium">Imported</th>
                    <th className="p-2 text-right font-medium">Queued</th>
                    <th className="p-2 text-right font-medium">Duplicates</th>
                    <th className="p-2 text-right font-medium">Skipped</th>
                    <th className="p-2 text-right font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                        {run.startedAt ? formatDateTime(run.startedAt) : "—"}
                      </td>
                      <td className="p-2">{run.bankCode}</td>
                      <td className="max-w-48 truncate p-2 text-xs">
                        {run.fileName ?? "—"}
                      </td>
                      <td className="p-2">
                        <span
                          className={
                            run.status === "succeeded"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                              : run.status === "failed"
                                ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                                : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          }
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="p-2 text-right tabular-nums">{run.imported}</td>
                      <td className="p-2 text-right tabular-nums">{run.queued}</td>
                      <td className="p-2 text-right tabular-nums">
                        {run.duplicates}
                      </td>
                      <td className="p-2 text-right tabular-nums">{run.skipped}</td>
                      <td className="p-2 text-right tabular-nums">{run.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
