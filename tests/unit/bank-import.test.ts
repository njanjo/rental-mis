import { describe, expect, it } from "vitest";

import {
  detectBankColumns,
  findKenyanPhone,
  parseBankStatement,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
} from "@/lib/bank-import";

const HEADER = "Date,Reference,Description,Credit,Debit,Phone";

function statement(rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

describe("parseCsv", () => {
  it("handles a BOM, CRLF and a quoted field with a comma", () => {
    const rows = parseCsv(
      '\uFEFFDate,Reference,Narration\r\n03/04/2026,REF1,"Rent, April"\r\n',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toEqual(["Date", "Reference", "Narration"]);
    expect(rows[1].cells).toEqual(["03/04/2026", "REF1", "Rent, April"]);
  });

  it("keeps newlines inside quotes and reports the opening line", () => {
    const rows = parseCsv('a,b\n1,"line one\nline two"\n');

    expect(rows[1].line).toBe(2);
    expect(rows[1].cells[1]).toBe("line one\nline two");
  });

  it("unescapes doubled quotes and skips blank records", () => {
    const rows = parseCsv('a,b\n1,"say ""hi"""\n\n,,\n');

    expect(rows).toHaveLength(2);
    expect(rows[1].cells[1]).toBe('say "hi"');
  });
});

describe("detectBankColumns", () => {
  it("finds a header below a statement preamble", () => {
    const rows = parseCsv(
      [
        "Equity Bank Statement",
        "Account 0123456789",
        "Transaction Date,Transaction Reference,Narration,Amount",
        "03/04/2026,REF1,Rent,25000.00",
      ].join("\n"),
    );

    const detected = detectBankColumns(rows);

    expect(detected.headerRowIndex).toBe(2);
    expect(detected.headerLine).toBe(3);
    expect(detected.mapping.date).toBe(0);
    expect(detected.mapping.reference).toBe(1);
    expect(detected.mapping.narration).toBe(2);
    expect(detected.mapping.amount).toBe(3);
  });

  it("does not mistake a banner containing 'amount' for the header", () => {
    const rows = parseCsv(
      [
        "Statement amount summary",
        "Date,Ref,Credit,Debit",
        "03/04/2026,REF1,1000.00,",
      ].join("\n"),
    );

    expect(detectBankColumns(rows).headerRowIndex).toBe(1);
  });
});

describe("parseStatementDate", () => {
  it("reads day-first by default, never silently US", () => {
    expect(parseStatementDate("03/04/2026")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("31/12/2026")?.iso).toBe("2026-12-31");
  });

  it("honours an explicit month-first or ISO format", () => {
    expect(parseStatementDate("03/04/2026", "mdy")?.iso).toBe("2026-03-04");
    expect(parseStatementDate("2026-04-03", "iso")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("03/04/2026", "dmy")?.iso).toBe("2026-04-03");
  });

  it("accepts month names, two-digit years and ignores a time", () => {
    expect(parseStatementDate("03 Apr 2026")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("3-Apr-26")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("Apr 3, 2026")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("03/04/2026 14:35:00")?.iso).toBe("2026-04-03");
  });

  it("rejects impossible or unreadable dates", () => {
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("not a date")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads plain, grouped and currency-prefixed credits", () => {
    expect(parseStatementAmount("25000")).toEqual({
      minor: 2_500_000,
      direction: "credit",
    });
    expect(parseStatementAmount("25,000.50")).toEqual({
      minor: 2_500_050,
      direction: "credit",
    });
    expect(parseStatementAmount("KES 1,500.00")?.minor).toBe(150_000);
    expect(parseStatementAmount("Ksh 1,500")?.minor).toBe(150_000);
  });

  it("marks debits from DR, brackets and a leading minus", () => {
    expect(parseStatementAmount("1,500.00 DR")).toEqual({
      minor: 150_000,
      direction: "debit",
    });
    expect(parseStatementAmount("(1,500.00)")).toEqual({
      minor: 150_000,
      direction: "debit",
    });
    expect(parseStatementAmount("-1500.00")).toEqual({
      minor: 150_000,
      direction: "debit",
    });
  });

  it("rejects unreadable money rather than guessing", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("many")).toBeNull();
    expect(parseStatementAmount("12.345")).toBeNull();
    expect(parseStatementAmount("1,2,3")).toBeNull();
  });
});

describe("findKenyanPhone", () => {
  it("finds national and international formats inside narration", () => {
    expect(findKenyanPhone("MPESA 0712 345 678 rent")).toBe("+254712345678");
    expect(findKenyanPhone("from +254723456789")).toBe("+254723456789");
    expect(findKenyanPhone("254733456789")).toBe("+254733456789");
  });

  it("does not confuse a reference or a short number with a phone", () => {
    expect(findKenyanPhone("REF 1234567890")).toBeNull();
    expect(findKenyanPhone("0712345")).toBeNull();
    expect(findKenyanPhone(undefined)).toBeNull();
  });
});

describe("parseBankStatement", () => {
  it("keeps credits and skips debits, totals and repeated headers", () => {
    const parsed = parseBankStatement(
      statement([
        "03/04/2026,REF1,Rent,45000.00,,+254712345678",
        "03/04/2026,REF2,Service charge,,1200.00,",
        "Totals,,,45000.00,1200.00,",
        "Date,Reference,Description,Credit,Debit,Phone",
        "04/04/2026,REF3,Rent,45000.00,,254723456789",
      ]),
    );

    expect(parsed.headerLine).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((row) => row.reference)).toEqual(["REF1", "REF3"]);
    expect(parsed.rows[0].amountMinor).toBe(4_500_000);
    expect(parsed.rows[0].payerPhone).toBe("+254712345678");
    expect(parsed.skipped.map((issue) => issue.message)).toEqual([
      "Debit / withdrawal ignored",
      "Totals row",
      "Repeated header row",
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("reads a signed single amount column and phone text in narration", () => {
    const parsed = parseBankStatement(
      [
        "Date,Reference,Amount,Narration",
        "03/04/2026,REF1,-1200.00,Withdrawal",
        "04/04/2026,REF2,45000.00,MPESA 0712 345 678 April rent",
      ].join("\n"),
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].reference).toBe("REF2");
    expect(parsed.rows[0].amountMinor).toBe(4_500_000);
    expect(parsed.rows[0].payerPhone).toBe("+254712345678");
    expect(parsed.skipped[0].message).toBe("Debit / withdrawal ignored");
  });

  it("reports bad rows without dropping the rest of the file", () => {
    const parsed = parseBankStatement(
      statement([
        "not-a-date,REF0,Rent,1000.00,,",
        "03/04/2026,,Rent,1000.00,,",
        "03/04/2026,REF1,Rent,45000.00,,+254712345678",
      ]),
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0].line).toBe(2);
    expect(parsed.errors[0].message).toContain("Unreadable date");
    expect(parsed.errors[1].message).toBe("Missing transaction reference.");
  });

  it("applies a manual mapping, including clearing a detected column", () => {
    const csv = [
      "When,Ref,In,Out,Phone",
      "03/04/2026,REF1,45000.00,,0712345678",
      "04/04/2026,REF2,1000.00,,0723456789",
    ].join("\n");

    const parsed = parseBankStatement(csv, {
      mapping: { date: 0, reference: 1, credit: 2, debit: 3, phone: 4 },
    });

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].payerPhone).toBe("+254712345678");

    const cleared = parseBankStatement(csv, {
      mapping: { date: 0, reference: 1, credit: 2, debit: 3, phone: -1 },
    });
    expect(cleared.rows[0].payerPhone).toBeUndefined();
  });

  it("requires a date, reference and an amount source", () => {
    expect(() =>
      parseBankStatement("Reference,Amount\nREF1,1000\n"),
    ).toThrow(/transaction date/i);
    expect(() =>
      parseBankStatement("Date,Amount\n03/04/2026,1000\n"),
    ).toThrow(/transaction reference/i);
    expect(() =>
      parseBankStatement("Date,Reference\n03/04/2026,REF1\n"),
    ).toThrow(/amount column/i);
  });

  it("refuses a file with no credit receipts", () => {
    expect(() =>
      parseBankStatement(statement(["03/04/2026,REF2,Fee,,1200.00,"])),
    ).toThrow(/only contains debits/i);
  });
});
