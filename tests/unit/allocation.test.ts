import { describe, expect, it } from "vitest";

import { planAllocation, type AllocatableInvoice } from "@/lib/allocation";

function invoice(
  id: string,
  dueDate: string,
  balanceMinor: number,
): AllocatableInvoice {
  return { id, dueDate, balanceMinor };
}

describe("planAllocation", () => {
  it("pays the oldest due invoice first", () => {
    const plan = planAllocation(
      [
        invoice("inv_new", "2026-03-05", 4_500_000),
        invoice("inv_old", "2026-01-05", 4_500_000),
        invoice("inv_mid", "2026-02-05", 4_500_000),
      ],
      10_000_000,
    );

    expect(plan.allocations).toEqual([
      { invoiceId: "inv_old", amountMinor: 4_500_000 },
      { invoiceId: "inv_mid", amountMinor: 4_500_000 },
      { invoiceId: "inv_new", amountMinor: 1_000_000 },
    ]);
    expect(plan.allocatedMinor).toBe(10_000_000);
    expect(plan.remainderMinor).toBe(0);
  });

  it("leaves the surplus as credit when the payment exceeds the debt", () => {
    const plan = planAllocation(
      [invoice("inv_1", "2026-01-05", 4_500_000)],
      5_000_000,
    );

    expect(plan.allocations).toEqual([
      { invoiceId: "inv_1", amountMinor: 4_500_000 },
    ]);
    expect(plan.allocatedMinor).toBe(4_500_000);
    expect(plan.remainderMinor).toBe(500_000);
  });

  it("turns the whole payment into credit when nothing is owed", () => {
    const plan = planAllocation([], 3_200_000);
    expect(plan.allocations).toEqual([]);
    expect(plan.allocatedMinor).toBe(0);
    expect(plan.remainderMinor).toBe(3_200_000);
  });

  it("ignores settled invoices and takes ties in id order", () => {
    const plan = planAllocation(
      [
        invoice("inv_b", "2026-01-05", 1_000_000),
        invoice("inv_a", "2026-01-05", 1_000_000),
        invoice("inv_paid", "2025-12-05", 0),
        invoice("inv_over", "2025-11-05", -100),
      ],
      3_000_000,
    );

    expect(plan.allocations.map((line) => line.invoiceId)).toEqual([
      "inv_a",
      "inv_b",
    ]);
    expect(plan.remainderMinor).toBe(1_000_000);
  });

  it("accepts Date due dates and never allocates a non-positive amount", () => {
    const plan = planAllocation(
      [{ id: "inv_1", dueDate: new Date("2026-01-05T00:00:00+03:00"), balanceMinor: 100 }],
      0,
    );
    expect(plan.allocations).toEqual([]);
    expect(plan.remainderMinor).toBe(0);

    const negative = planAllocation(
      [invoice("inv_1", "2026-01-05", 100)],
      -500,
    );
    expect(negative.allocations).toEqual([]);
    expect(negative.remainderMinor).toBe(0);
  });

  it("splits a part payment without marking the invoice settled", () => {
    const plan = planAllocation(
      [invoice("inv_1", "2026-01-05", 4_500_000)],
      1_500_000,
    );

    expect(plan.allocations).toEqual([
      { invoiceId: "inv_1", amountMinor: 1_500_000 },
    ]);
    expect(plan.remainderMinor).toBe(0);
  });
});
