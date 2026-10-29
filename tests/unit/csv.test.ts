import { describe, expect, it } from "vitest";

import { csvFile, csvFilename } from "@/lib/csv";

describe("csvFile", () => {
  it("renders a BOM, header and CRLF rows", () => {
    const csv = csvFile(["Ref", "Name"], [
      ["001", "Grace"],
      ["002", "John Doe"],
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Ref,Name\r\n001,Grace\r\n002,John Doe\r\n");
  });

  it("quotes fields containing commas, quotes and newlines", () => {
    const csv = csvFile(["Narration", "Note"], [
      ['M-PESA transfer, "Rent"', "line one\nline two"],
    ]);
    // Embedded quotes are doubled; the whole field is wrapped.
    expect(csv).toContain('"M-PESA transfer, ""Rent""","line one\nline two"');
  });

  it("does not quote plain values and leaves numbers as-is", () => {
    const csv = csvFile(["Amount", "Name"], [
      [45_000.5, "Plain Name"],
      [null, undefined],
    ]);
    expect(csv).toContain("Amount,Name\r\n45000.5,Plain Name\r\n,\r\n");
  });

  it("quotes trailing spaces so spreadsheet round-trips keep them", () => {
    const csv = csvFile(["Note"], [["trailing "]]);
    expect(csv).toContain('"trailing "');
  });
});

describe("csvFilename", () => {
  it("keeps the id/date slug shape", () => {
    expect(csvFilename("rental-mis-payments", "2026-10-01", "2026-12-31")).toBe(
      "rental-mis-payments_2026-10-01_to_2026-12-31.csv",
    );
  });

  it("sanitises odd prefixes", () => {
    expect(csvFilename("Odd / Type!", "2026-01-01", "2026-01-02")).toBe(
      "Odd-Type_2026-01-01_to_2026-01-02.csv",
    );
  });
});
