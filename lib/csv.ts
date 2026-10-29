/**
 * CSV serialisation for the Reports module. RFC 4180 quoting: a field is
 * wrapped in double quotes when it contains a comma, quote, newline or
 * leading/trailing space, and embedded quotes are doubled. A UTF-8 BOM keeps
 * Excel (still the default CSV consumer in Kenyan property offices) honest
 * about encoding, and rows end with CRLF like the RFC recommends.
 */

const QUOTE_NEEDED = /[",\r\n]|^\s|\s$/;

function escapeField(value: string): string {
  if (!QUOTE_NEEDED.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export type CsvCell = string | number | null | undefined;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  // Numbers flow through untouched, everything else is coerced once.
  return escapeField(typeof value === "number" ? String(value) : value);
}

/**
 * Build the full CSV text — BOM, header row, one CRLF-terminated row per entry.
 */
export function csvFile(
  headers: string[],
  rows: CsvCell[][],
): string {
  const lines = [
    headers.map(cell).join(","),
    ...rows.map((row) => row.map(cell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Attach the BOM-free, download-safe filename for a csv response. */
export function csvFilename(prefix: string, from: string, to: string): string {
  const safe = prefix.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "");
  return `${safe || "report"}_${from}_to_${to}.csv`;
}
