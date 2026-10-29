/**
 * Bank statement CSV parsing.
 *
 * Pure functions only: no Firestore, no Node APIs. The importer calls these on
 * the server, and tests exercise them directly. Nothing here decides who a
 * payment belongs to - it only turns a bank's file into clean rows.
 *
 * Kenyan banks export wildly different headers and preamble lines, so the
 * parser detects the header row and maps the common column names, while the
 * import screen lets a person correct the mapping before anything is written.
 */

import { parseDateInput } from "@/lib/dates";
import type { BankImportFormState } from "@/lib/types/views";
import { MAX_AMOUNT_MINOR } from "@/lib/validation/money";
import { normalisePaymentReference } from "@/lib/payment-reference";
import { normaliseKenyanPhone } from "@/lib/phone";

/** Initial useActionState value for the import wizard. Client-safe, not a `"use server"` export. */
export const IDLE_BANK_IMPORT_STATE: BankImportFormState = { status: "idle" };

export const BANK_IMPORT_MAX_BYTES = 2_000_000;
/** Bound the work one file may create; split bigger statements by month. */
export const BANK_IMPORT_MAX_ROWS = 2_000;
/** Rows shown in the preview table; the commit still processes every row. */
export const BANK_IMPORT_PREVIEW_ROWS = 300;
/** Column index used when a field is not mapped. */
export const UNUSED_COLUMN = -1;

export const BANK_DATE_FORMATS = ["auto", "dmy", "mdy", "iso"] as const;
export type BankImportDateFormat = (typeof BANK_DATE_FORMATS)[number];

export const BANK_DATE_FORMAT_LABELS: Record<BankImportDateFormat, string> = {
  auto: "Detect automatically (day first)",
  dmy: "Day / Month / Year",
  mdy: "Month / Day / Year",
  iso: "Year - Month - Day",
};

export const BANK_COLUMN_KEYS = [
  "date",
  "reference",
  "amount",
  "credit",
  "debit",
  "phone",
  "payerName",
  "narration",
] as const;
export type BankColumnKey = (typeof BANK_COLUMN_KEYS)[number];

/** Header labels for the mapping screen. `amount` and `credit`/`debit` are alternatives. */
export const BANK_COLUMN_LABELS: Record<BankColumnKey, string> = {
  date: "Transaction date",
  reference: "Transaction reference",
  amount: "Amount (one signed column)",
  credit: "Credit / money in",
  debit: "Debit / money out",
  phone: "Payer phone",
  payerName: "Payer name",
  narration: "Narration",
};

/** Columns a statement cannot be imported without. */
export const REQUIRED_BANK_COLUMNS: BankColumnKey[] = ["date", "reference"];

export type BankColumnMapping = Record<BankColumnKey, number>;

export function emptyBankMapping(): BankColumnMapping {
  return {
    date: UNUSED_COLUMN,
    reference: UNUSED_COLUMN,
    amount: UNUSED_COLUMN,
    credit: UNUSED_COLUMN,
    debit: UNUSED_COLUMN,
    phone: UNUSED_COLUMN,
    payerName: UNUSED_COLUMN,
    narration: UNUSED_COLUMN,
  };
}

/** Common Kenyan banks, offered as hints in the import form. */
export const KENYAN_BANKS: Array<{ code: string; name: string }> = [
  { code: "EQ", name: "Equity Bank" },
  { code: "KCB", name: "KCB Bank" },
  { code: "COOP", name: "Co-operative Bank" },
  { code: "NCBA", name: "NCBA Bank" },
  { code: "ABSA", name: "Absa Bank Kenya" },
  { code: "STANBIC", name: "Stanbic Bank" },
  { code: "DTB", name: "Diamond Trust Bank" },
  { code: "FAMILY", name: "Family Bank" },
  { code: "IM", name: "I&M Bank" },
  { code: "SCB", name: "Standard Chartered" },
  { code: "NIC", name: "NIC Bank" },
  { code: "PRIME", name: "Prime Bank" },
  { code: "SIDIAN", name: "Sidian Bank" },
  { code: "KINGDOM", name: "Kingdom Bank" },
  { code: "GULF", name: "Gulf African Bank" },
  { code: "FCB", name: "First Community Bank" },
  { code: "CRDB", name: "CRDB Bank" },
  { code: "ACCESS", name: "Access Bank Kenya" },
  { code: "POSTBANK", name: "Postbank" },
  { code: "OTHER", name: "Other bank" },
];

// ---------------------------------------------------------------------------
// CSV tokenising
// ---------------------------------------------------------------------------

export interface CsvRow {
  /** 1-based line in the file where this record starts. */
  line: number;
  cells: string[];
}

/**
 * RFC 4180-style reader: quoted fields, escaped quotes, CRLF/LF and a UTF-8 BOM.
 * Records may span lines inside quotes; `line` keeps pointing at the opening
 * line so error messages match what a person sees in a text editor.
 */
export function parseCsv(text: string): CsvRow[] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const pushRecord = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim() !== "")) {
      rows.push({ line: recordLine, cells });
    }
    cells = [];
    field = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      cells.push(field);
      field = "";
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }

    field += char;
  }

  // Flush the final record when the file does not end with a newline.
  if (field !== "" || cells.length > 0) pushRecord();

  return rows;
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<BankColumnKey, string[]> = {
  date: [
    "date",
    "transactiondate",
    "transdate",
    "valuedate",
    "txndate",
    "postingdate",
    "bookingdate",
  ],
  reference: [
    "reference",
    "ref",
    "referenceno",
    "referencenumber",
    "transactionreference",
    "transactionref",
    "transactionid",
    "transid",
    "txnid",
    "receiptno",
    "receiptnumber",
    "chequeno",
    "chequenumber",
    "documentno",
    "docno",
  ],
  amount: ["amount", "amountkes", "transactionamount", "value", "money"],
  credit: [
    "credit",
    "creditamount",
    "moneyin",
    "deposit",
    "deposits",
    "paidin",
    "cr",
    "inflow",
  ],
  debit: [
    "debit",
    "debitamount",
    "moneyout",
    "withdrawal",
    "withdrawals",
    "paidout",
    "dr",
    "outflow",
  ],
  phone: [
    "phone",
    "phonenumber",
    "mobile",
    "mobilenumber",
    "msisdn",
    "contact",
    "telephone",
    "tel",
    "payerphone",
  ],
  payerName: [
    "payer",
    "payername",
    "customer",
    "customername",
    "name",
    "depositor",
    "sender",
    "remitter",
    "accountname",
  ],
  narration: [
    "narration",
    "description",
    "details",
    "particulars",
    "narrative",
    "transactiondetails",
    "remarks",
    "memo",
  ],
};

export interface DetectedBankColumns {
  /** Index into the parsed rows, not a file line. */
  headerRowIndex: number;
  headerLine: number;
  headers: string[];
  mapping: BankColumnMapping;
}

/**
 * Find the header row by scoring the first 25 rows against known bank headers.
 * Statements often carry an account-name banner and a date range above the
 * real header, so row 1 is not assumed.
 */
export function detectBankColumns(rows: CsvRow[]): DetectedBankColumns {
  const limit = Math.min(rows.length, 25);
  let bestIndex = 0;
  let bestScore = -1;
  let bestMapping = emptyBankMapping();

  for (let index = 0; index < limit; index += 1) {
    const cells = rows[index]?.cells ?? [];
    const mapping = emptyBankMapping();
    let score = 0;

    cells.forEach((cell, column) => {
      const header = normaliseHeader(cell);
      if (!header) return;

      for (const key of BANK_COLUMN_KEYS) {
        if (mapping[key] !== UNUSED_COLUMN) continue;
        if (HEADER_ALIASES[key].includes(header)) {
          mapping[key] = column;
          score += 1;
          break;
        }
      }
    });

    // A row with a date and a reference column is much more likely to be the
    // header than an account banner that happens to contain the word "amount".
    if (mapping.date !== UNUSED_COLUMN) score += 1;
    if (mapping.reference !== UNUSED_COLUMN) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      bestMapping = mapping;
    }
  }

  // No usable header: expose the first row so the user can still map columns.
  if (bestScore < 2) {
    return {
      headerRowIndex: 0,
      headerLine: rows[0]?.line ?? 1,
      headers: rows[0]?.cells ?? [],
      mapping: emptyBankMapping(),
    };
  }

  return {
    headerRowIndex: bestIndex,
    headerLine: rows[bestIndex]?.line ?? 1,
    headers: rows[bestIndex]?.cells ?? [],
    mapping: bestMapping,
  };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function buildIsoDate(
  year: number,
  month: number,
  day: number,
): { iso: string; date: Date } | null {
  const fullYear = year < 100 ? 2000 + year : year;
  if (fullYear < 2000 || fullYear > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${fullYear}-${pad(month)}-${pad(day)}`;
  const date = parseDateInput(iso);
  return date ? { iso, date } : null;
}

const ISO_LIKE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const DAY_FIRST = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const DAY_MONTH_NAME = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/;
const MONTH_NAME_FIRST = /^([A-Za-z]{3,})[-/\s](\d{1,2}),?[-/\s](\d{2,4})$/;

/**
 * Parse the date shapes Kenyan bank exports use. `auto` and `dmy` read
 * `03/04/2026` as 3 April (day first); only `mdy` treats it as March 4.
 * Times are ignored because rent is dated by the business calendar.
 */
export function parseStatementDate(
  raw: string,
  format: BankImportDateFormat = "auto",
): { iso: string; date: Date } | null {
  const value = raw
    .trim()
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, "")
    .trim();
  if (!value) return null;

  const iso = ISO_LIKE.exec(value);
  if (iso && format !== "dmy" && format !== "mdy") {
    return buildIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const numeric = DAY_FIRST.exec(value);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    return format === "mdy"
      ? buildIsoDate(year, first, second)
      : buildIsoDate(year, second, first);
  }

  const dayName = DAY_MONTH_NAME.exec(value);
  if (dayName) {
    const month = MONTHS[dayName[2].toLowerCase()];
    if (month) {
      return buildIsoDate(Number(dayName[3]), month, Number(dayName[1]));
    }
  }

  const nameDay = MONTH_NAME_FIRST.exec(value);
  if (nameDay) {
    const month = MONTHS[nameDay[1].toLowerCase()];
    if (month) {
      return buildIsoDate(Number(nameDay[3]), month, Number(nameDay[2]));
    }
  }

  return null;
}

export interface StatementAmount {
  minor: number;
  direction: "credit" | "debit";
}

/**
 * Parse a statement money cell into minor units plus its direction. Handles
 * `25,000.00`, `KES 25,000.00`, `25,000.00 CR`, `1,500.00 DR`, `(1,500.00)`
 * and a leading minus. Anything unreadable returns null - the row becomes an
 * error rather than a guessed amount.
 */
export function parseStatementAmount(raw: string): StatementAmount | null {
  let value = raw.trim();
  if (!value) return null;

  let direction: "credit" | "debit" = "credit";

  const suffix = /(?:^|\s)(CR|DR)\.?$/i.exec(value);
  if (suffix) {
    if (suffix[1].toUpperCase() === "DR") direction = "debit";
    value = value.slice(0, suffix.index).trim();
  } else {
    const prefix = /^(CR|DR)\.?\s+/i.exec(value);
    if (prefix) {
      if (prefix[1].toUpperCase() === "DR") direction = "debit";
      value = value.slice(prefix[0].length).trim();
    }
  }

  if (/^\(.*\)$/.test(value)) {
    direction = "debit";
    value = value.slice(1, -1).trim();
  }

  if (value.startsWith("-")) {
    direction = "debit";
    value = value.slice(1).trim();
  } else if (value.startsWith("+")) {
    value = value.slice(1).trim();
  }

  value = value
    .replace(/\b(kes|ksh|shs|sh)\b/gi, "")
    .replace(/[^\d.,]/g, "")
    .trim();

  // Reject malformed grouping (1,2,3) instead of quietly reading it as 123.
  if (!value || !/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const minor = Math.round(Number(value.replace(/,/g, "")) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_AMOUNT_MINOR) {
    return null;
  }
  return { minor, direction };
}

/**
 * Find a Kenyan mobile number written inside free text. Requires a country
 * code or a leading zero so reference numbers are not mistaken for phones.
 */
export function findKenyanPhone(text: string | undefined): string | null {
  if (!text) return null;
  const compact = text.replace(/[\s-]/g, "");
  // Allow letters after the number (e.g. "0712345678RENT") but never match
  // inside a longer digit string such as a reference number.
  const match = /(?<!\d)(?:\+?254|0)([17]\d{8})(?!\d)/.exec(compact);
  return match ? normaliseKenyanPhone(match[0]) : null;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Statement parsing
// ---------------------------------------------------------------------------

export interface ParsedStatementRow {
  line: number;
  dateIso: string;
  date: Date;
  reference: string;
  amountMinor: number;
  payerName?: string;
  /** Normalised phone, or a phone found in the narration. */
  payerPhone?: string;
  narration?: string;
}

export interface BankRowIssue {
  line: number;
  kind: "skipped" | "error";
  message: string;
}

export interface ParsedBankStatement {
  headers: string[];
  headerLine: number;
  mapping: BankColumnMapping;
  dateFormat: BankImportDateFormat;
  /** Credits only, ready for matching. */
  rows: ParsedStatementRow[];
  skipped: BankRowIssue[];
  errors: BankRowIssue[];
}

export interface ParseBankStatementOptions {
  mapping?: Partial<BankColumnMapping>;
  dateFormat?: BankImportDateFormat;
}

function mergeMapping(
  detected: BankColumnMapping,
  override?: Partial<BankColumnMapping>,
): BankColumnMapping {
  const merged = { ...detected };
  if (!override) return merged;
  for (const key of BANK_COLUMN_KEYS) {
    const value = override[key];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      (value >= 0 || value === UNUSED_COLUMN)
    ) {
      merged[key] = value;
    }
  }
  return merged;
}

function validateMapping(mapping: BankColumnMapping, headers: string[]): void {
  for (const key of REQUIRED_BANK_COLUMNS) {
    if (mapping[key] === UNUSED_COLUMN) {
      throw new Error(
        `Choose the column that holds the ${BANK_COLUMN_LABELS[key].toLowerCase()}.`,
      );
    }
    if (mapping[key] >= headers.length) {
      throw new Error(
        `The ${BANK_COLUMN_LABELS[key].toLowerCase()} column is outside this file. Re-check the mapping.`,
      );
    }
  }

  const hasSingle = mapping.amount !== UNUSED_COLUMN;
  const hasSplit = mapping.credit !== UNUSED_COLUMN || mapping.debit !== UNUSED_COLUMN;
  if (!hasSingle && !hasSplit) {
    throw new Error(
      "Choose an amount column, or the credit/debit columns, before importing.",
    );
  }
}

/** Parse a whole file. Throws only for file-level problems (size, mapping). */
export function parseBankStatement(
  text: string,
  options: ParseBankStatementOptions = {},
): ParsedBankStatement {
  if (!text.trim()) {
    throw new Error("Choose a statement file to import.");
  }
  if (text.length > BANK_IMPORT_MAX_BYTES) {
    throw new Error("That file is larger than 2 MB. Export a smaller date range.");
  }

  const csvRows = parseCsv(text);
  if (csvRows.length < 2) {
    throw new Error("That file has no data rows.");
  }
  if (csvRows.length > BANK_IMPORT_MAX_ROWS + 30) {
    throw new Error(
      `That file has more than ${BANK_IMPORT_MAX_ROWS.toLocaleString("en-KE")} rows. Split it by month and import each file.`,
    );
  }

  const detected = detectBankColumns(csvRows);
  const mapping = mergeMapping(detected.mapping, options.mapping);
  const dateFormat = options.dateFormat ?? "auto";
  validateMapping(mapping, detected.headers);

  const headerNames = new Set(
    detected.headers.map((header) => normaliseHeader(header)).filter(Boolean),
  );

  const rows: ParsedStatementRow[] = [];
  const skipped: BankRowIssue[] = [];
  const errors: BankRowIssue[] = [];

  for (let index = detected.headerRowIndex + 1; index < csvRows.length; index += 1) {
    const csvRow = csvRows[index];
    const cells = csvRow.cells;

    // A repeated header appears when a statement was printed page by page.
    const nonEmpty = cells.filter((cell) => cell.trim() !== "");
    if (nonEmpty.length === 0) continue;
    const firstNormalised = normaliseHeader(nonEmpty[0]);
    if (
      nonEmpty.length >= 2 &&
      headerNames.has(firstNormalised) &&
      cells.filter((cell) => headerNames.has(normaliseHeader(cell))).length >= 2
    ) {
      skipped.push({
        line: csvRow.line,
        kind: "skipped",
        message: "Repeated header row",
      });
      continue;
    }

    if (/^totals?\b/i.test(nonEmpty[0])) {
      skipped.push({
        line: csvRow.line,
        kind: "skipped",
        message: "Totals row",
      });
      continue;
    }

    const cell = (key: BankColumnKey) => {
      const column = mapping[key];
      return column === UNUSED_COLUMN ? "" : (cells[column] ?? "").trim();
    };

    const dateValue = cell("date");
    const parsedDate = parseStatementDate(dateValue, dateFormat);
    if (!parsedDate) {
      errors.push({
        line: csvRow.line,
        kind: "error",
        message: dateValue
          ? `Unreadable date "${dateValue}".`
          : "Missing transaction date.",
      });
      continue;
    }

    const reference = normalisePaymentReference(cell("reference"));
    if (!reference) {
      errors.push({
        line: csvRow.line,
        kind: "error",
        message: "Missing transaction reference.",
      });
      continue;
    }
    if (reference.length > 80) {
      errors.push({
        line: csvRow.line,
        kind: "error",
        message: "Transaction reference is longer than 80 characters.",
      });
      continue;
    }

    let amountMinor = 0;
    let debit = false;

    if (mapping.credit !== UNUSED_COLUMN || mapping.debit !== UNUSED_COLUMN) {
      const credit = parseStatementAmount(cell("credit"));
      const debitColumn = parseStatementAmount(cell("debit"));
      if (credit && credit.minor > 0) {
        amountMinor = credit.minor;
      } else if (debitColumn && debitColumn.minor > 0) {
        debit = true;
        amountMinor = debitColumn.minor;
      } else {
        errors.push({
          line: csvRow.line,
          kind: "error",
          message: "Both credit and debit are empty or unreadable.",
        });
        continue;
      }
    } else {
      const amountValue = cell("amount");
      const parsedAmount = parseStatementAmount(amountValue);
      if (!parsedAmount) {
        errors.push({
          line: csvRow.line,
          kind: "error",
          message: amountValue
            ? `Unreadable amount "${amountValue}".`
            : "Missing amount.",
        });
        continue;
      }
      debit = parsedAmount.direction === "debit";
      amountMinor = parsedAmount.minor;
    }

    if (debit) {
      skipped.push({
        line: csvRow.line,
        kind: "skipped",
        message: "Debit / withdrawal ignored",
      });
      continue;
    }
    if (amountMinor === 0) {
      skipped.push({
        line: csvRow.line,
        kind: "skipped",
        message: "Zero amount ignored",
      });
      continue;
    }

    const narration = optional(cell("narration"));
    const rawPhone = cell("phone");
    const payerPhone =
      (rawPhone ? normaliseKenyanPhone(rawPhone) : null) ??
      findKenyanPhone(narration) ??
      undefined;

    rows.push({
      line: csvRow.line,
      dateIso: parsedDate.iso,
      date: parsedDate.date,
      reference,
      amountMinor,
      payerName: optional(cell("payerName")),
      ...(payerPhone ? { payerPhone } : {}),
      ...(narration ? { narration } : {}),
    });
  }

  if (rows.length > BANK_IMPORT_MAX_ROWS) {
    throw new Error(
      `That file has more than ${BANK_IMPORT_MAX_ROWS.toLocaleString("en-KE")} receipts. Split it by month and import each file.`,
    );
  }

  if (rows.length === 0) {
    throw new Error(
      errors.length > 0
        ? "No importable receipts. Fix the file or the column mapping and try again."
        : "No credit receipts found. This file only contains debits or blank rows.",
    );
  }

  return {
    headers: detected.headers,
    headerLine: detected.headerLine,
    mapping,
    dateFormat,
    rows,
    skipped,
    errors,
  };
}
