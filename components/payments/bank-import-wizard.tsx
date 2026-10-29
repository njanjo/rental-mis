"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Inbox,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/shared/field";
import { FormAlert } from "@/components/shared/form-alert";
import { NativeSelect } from "@/components/shared/native-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IDLE_BANK_IMPORT_STATE,
  type BankColumnKey,
  type BankImportDateFormat,
} from "@/lib/bank-import";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  BankImportFormState,
  BankImportPreview,
} from "@/lib/types/views";
import { cn } from "@/lib/utils";
import {
  commitBankStatementAction,
  previewBankStatementAction,
} from "@/app/(dashboard)/payments/import/actions";

const MAX_FILE_BYTES = 2_000_000;

export interface BankOption {
  code: string;
  name: string;
}

export interface ColumnOption {
  key: BankColumnKey;
  label: string;
  required: boolean;
}

export interface DateFormatOption {
  value: BankImportDateFormat;
  label: string;
}

interface BankImportWizardProps {
  banks: BankOption[];
  columns: ColumnOption[];
  dateFormats: DateFormatOption[];
}

const MATCH_STYLES: Record<string, string> = {
  tenant: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  unmatched: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  out_of_scope: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  duplicate: "bg-muted text-muted-foreground",
};

const MATCH_LABELS: Record<string, string> = {
  tenant: "Matched",
  unmatched: "Unmatched",
  out_of_scope: "Out of scope",
  duplicate: "Already imported",
};

function previewFor(
  state: BankImportFormState,
  fileName: string,
): BankImportPreview | undefined {
  const preview = state.preview;
  if (!preview) return undefined;
  if (preview.fileName && fileName && preview.fileName !== fileName) {
    return undefined;
  }
  return preview;
}

export function BankImportWizard({
  banks,
  columns,
  dateFormats,
}: BankImportWizardProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [bankCode, setBankCode] = useState(banks[0]?.code ?? "OTHER");
  const [dateFormat, setDateFormat] =
    useState<BankImportDateFormat>("auto");
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [previewState, previewAction] = useActionState(
    previewBankStatementAction,
    IDLE_BANK_IMPORT_STATE,
  );
  const [commitState, commitAction] = useActionState(
    commitBankStatementAction,
    IDLE_BANK_IMPORT_STATE,
  );

  const preview = csv ? previewFor(previewState, fileName) : undefined;

  useEffect(() => {
    if (preview) setMapping(preview.mapping);
  }, [preview]);

  useEffect(() => {
    if (commitState.status !== "success" || !commitState.result) return;
    toast.success(commitState.message ?? "Statement imported");
    setCsv("");
    setFileName("");
    setMapping(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }, [commitState, router]);

  const mappingDirty = useMemo(() => {
    if (!preview || !mapping) return false;
    return columns.some((column) => preview.mapping[column.key] !== mapping[column.key]);
  }, [preview, mapping, columns]);

  const importable = preview
    ? preview.totals.dataRows - preview.totals.duplicates
    : 0;

  const showResult = commitState.status === "success" && commitState.result;

  async function handleFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is larger than 2 MB. Export a smaller date range.");
      return;
    }

    const text = await file.text();
    if (!text.trim()) {
      setFileError("That file is empty.");
      return;
    }

    setCsv(text);
    setFileName(file.name);
    setMapping(null);
  }

  function setColumn(key: BankColumnKey, value: number) {
    setMapping((current) => ({
      ...(current ?? {}),
      [key]: value,
    }));
  }

  const mappingJson = mapping ? JSON.stringify(mapping) : "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4" />
            1. Choose a statement
          </CardTitle>
          <CardDescription>
            Export a CSV from your bank. Only credit receipts are imported;
            debits, totals and blank lines are skipped. A payer phone is
            required to match a tenant automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Statement file"
              htmlFor="statementFile"
              required
              error={fileError ? [fileError] : undefined}
              hint="CSV up to 2 MB and 2,000 credit rows."
            >
              <input
                ref={fileRef}
                id="statementFile"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => void handleFile(event.target.files?.[0])}
                className="block w-full cursor-pointer rounded-lg border border-input bg-transparent text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank" htmlFor="bankCode" required>
                <NativeSelect
                  id="bankCode"
                  value={bankCode}
                  onChange={(event) => setBankCode(event.target.value)}
                >
                  {banks.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                label="Date format"
                htmlFor="dateFormat"
                hint="Day-first is the Kenyan default."
              >
                <NativeSelect
                  id="dateFormat"
                  value={dateFormat}
                  onChange={(event) =>
                    setDateFormat(event.target.value as BankImportDateFormat)
                  }
                >
                  {dateFormats.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </div>

          <form action={previewAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="fileName" value={fileName} />
            <input type="hidden" name="bankCode" value={bankCode} />
            <input type="hidden" name="dateFormat" value={dateFormat} />
            <input type="hidden" name="mapping" value={mappingJson} />
            <SubmitButton
              pendingLabel="Reading statement…"
              disabled={!csv}
              className="gap-2"
            >
              <Upload className="size-4" />
              Preview statement
            </SubmitButton>
            {fileName ? (
              <span className="text-xs text-muted-foreground">
                {fileName}
                {csv ? ` · ${(csv.length / 1024).toFixed(0)} KB` : ""}
              </span>
            ) : null}
          </form>

          {!csv ? (
            <p className="text-xs text-muted-foreground">
              Nothing is written during preview. You will see every row and its
              match before importing.
            </p>
          ) : null}

          {previewState.status === "error" ? (
            <FormAlert state={previewState} />
          ) : null}
          {commitState.status === "error" ? (
            <FormAlert state={commitState} />
          ) : null}
        </CardContent>
      </Card>

      {showResult && commitState.result ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Statement imported
            </CardTitle>
            <CardDescription>{commitState.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <ResultStat label="Imported" value={commitState.result.imported} />
              <ResultStat label="Queued" value={commitState.result.queued} />
              <ResultStat
                label="Duplicates"
                value={commitState.result.duplicates}
              />
              <ResultStat label="Skipped" value={commitState.result.skipped} />
              <ResultStat label="Errors" value={commitState.result.errors} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/payments">All payments</Link>
              </Button>
              {commitState.result.queued > 0 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/payments/unmatched">
                    <Inbox className="size-4" />
                    Review {commitState.result.queued} queued
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Check and import</CardTitle>
            <CardDescription>
              Detected header on line {preview.headerLine}. Match{" "}
              {preview.totals.matched} of {preview.totals.dataRows} credit rows
              by phone. Rows without a reliable match go to the unmatched queue;
              nothing is guessed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <SummaryStat label="Credits" value={preview.totals.dataRows} />
              <SummaryStat label="Matched" value={preview.totals.matched} />
              <SummaryStat label="Unmatched" value={preview.totals.unmatched} />
              <SummaryStat
                label="Out of scope"
                value={preview.totals.outOfScope}
              />
              <SummaryStat
                label="Duplicates"
                value={preview.totals.duplicates}
              />
              <SummaryStat label="Skipped" value={preview.totals.skipped} />
              <SummaryStat label="Errors" value={preview.totals.errors} />
            </div>

            <p className="text-sm text-muted-foreground">
              Statement credits total{" "}
              <span className="font-medium text-foreground">
                {formatMoney(preview.totals.amountMinor)}
              </span>
              . Debits are not imported.
            </p>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Column mapping</h3>
                {mappingDirty ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Mapping changed — update the preview before importing.
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {columns.map((column) => (
                  <Field
                    key={column.key}
                    label={column.label}
                    htmlFor={`mapping-${column.key}`}
                    required={column.required}
                  >
                    <NativeSelect
                      id={`mapping-${column.key}`}
                      value={String(mapping?.[column.key] ?? -1)}
                      onChange={(event) =>
                        setColumn(column.key, Number(event.target.value))
                      }
                    >
                      <option value="-1">Not used</option>
                      {preview.headers.map((header, index) => (
                        <option key={`${column.key}-${index}`} value={index}>
                          {header || `Column ${index + 1}`}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Use one signed amount column, or separate credit/debit columns.
                At least one amount source is required.
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="p-2 font-medium">Line</th>
                      <th className="p-2 font-medium">Date</th>
                      <th className="p-2 font-medium">Reference</th>
                      <th className="p-2 text-right font-medium">Amount</th>
                      <th className="p-2 font-medium">Payer</th>
                      <th className="p-2 font-medium">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={`${row.line}-${row.reference}`} className="border-t">
                        <td className="p-2 align-top text-xs text-muted-foreground">
                          {row.line}
                        </td>
                        <td className="whitespace-nowrap p-2 align-top">
                          {formatDate(row.date)}
                        </td>
                        <td className="p-2 align-top">
                          <span className="font-mono text-xs">{row.reference}</span>
                          {row.narration ? (
                            <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">
                              {row.narration}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap p-2 text-right align-top tabular-nums">
                          {formatMoney(row.amountMinor)}
                        </td>
                        <td className="p-2 align-top">
                          <span className="text-sm">
                            {row.payerName ?? row.tenantName ?? "Unknown payer"}
                          </span>
                          {row.payerPhone ? (
                            <p className="text-xs text-muted-foreground">
                              {row.payerPhone}
                            </p>
                          ) : null}
                        </td>
                        <td className="p-2 align-top">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              MATCH_STYLES[row.match],
                            )}
                          >
                            {MATCH_LABELS[row.match]}
                          </span>
                          {row.tenantName && row.match !== "tenant" ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.tenantName}
                            </p>
                          ) : null}
                          {row.reason ? (
                            <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                              {row.reason}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {preview.truncated ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {preview.rows.length} rows. The import still
                processes every row in the file.
              </p>
            ) : null}

            {preview.issues.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="size-4 text-amber-600" />
                  {preview.issues.length} row
                  {preview.issues.length === 1 ? "" : "s"} need attention
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {preview.issues.slice(0, 15).map((issue) => (
                    <li key={`${issue.line}-${issue.message}`}>
                      Line {issue.line}: {issue.message}
                    </li>
                  ))}
                </ul>
                {preview.issues.length > 15 ? (
                  <p className="text-xs text-muted-foreground">
                    …and {preview.issues.length - 15} more.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <form action={previewAction}>
                <input type="hidden" name="csv" value={csv} />
                <input type="hidden" name="fileName" value={fileName} />
                <input type="hidden" name="bankCode" value={bankCode} />
                <input type="hidden" name="dateFormat" value={dateFormat} />
                <input type="hidden" name="mapping" value={mappingJson} />
                <SubmitButton
                  variant="outline"
                  pendingLabel="Updating preview…"
                  disabled={!csv}
                >
                  Update preview
                </SubmitButton>
              </form>

              <form action={commitAction}>
                <input type="hidden" name="csv" value={csv} />
                <input type="hidden" name="fileName" value={fileName} />
                <input type="hidden" name="bankCode" value={bankCode} />
                <input type="hidden" name="dateFormat" value={dateFormat} />
                <input type="hidden" name="mapping" value={mappingJson} />
                <SubmitButton
                  pendingLabel="Importing receipts…"
                  disabled={mappingDirty || importable === 0}
                  className="gap-2"
                >
                  <FileUp className="size-4" />
                  Import {importable} receipt{importable === 1 ? "" : "s"}
                </SubmitButton>
              </form>

              <span className="text-xs text-muted-foreground">
                {importable === 0
                  ? "Nothing new to import in this preview."
                  : `${importable} receipt${importable === 1 ? "" : "s"} will be written; duplicates are skipped.`}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
