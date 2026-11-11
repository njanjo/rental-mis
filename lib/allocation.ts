/**
 * Payment allocation arithmetic.
 *
 * A confirmed payment is applied to the tenant's unpaid invoices in the
 * account's fill order — oldest due first by default (docs/DECISIONS.md #11),
 * newest due first when `systemSettings.billing.allocationStrategy` says so —
 * one invoice at a time. Anything left over is tenant credit, never a guessed
 * allocation. This module is pure so the rules are unit-testable without
 * Firestore; `services/allocations.ts` runs it inside a transaction.
 */

import type { MinorUnits } from "@/lib/types";

/** The minimum an allocation needs to know about an invoice. */
export interface AllocatableInvoice {
  id: string;
  /** Due date as a Date or ISO string; older dates are paid first by default. */
  dueDate: Date | string;
  balanceMinor: MinorUnits;
}

export interface PlannedAllocation {
  invoiceId: string;
  amountMinor: MinorUnits;
}

export interface AllocationPlan {
  /** In fill order (oldest due first by default); every amount is positive. */
  allocations: PlannedAllocation[];
  allocatedMinor: MinorUnits;
  /** Money not covered by any invoice; becomes tenant credit. */
  remainderMinor: MinorUnits;
}

export interface AllocationOptions {
  /** Invoice fill order; ties on due date still break on invoice id. */
  order?: "oldest_first" | "newest_first";
}

function dueTime(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
}

/**
 * Allocate `amountMinor` across `invoices`, oldest due first by default.
 *
 * - `options.order` flips the fill order: `newest_first` fills the newest due
 *   invoice first (`systemSettings.billing.allocationStrategy`,
 *   docs/DECISIONS.md #11). Anything else falls back to oldest-first.
 * - Invoices with a zero or negative balance are ignored.
 * - Ties on the due date break on invoice id so the plan is deterministic.
 * - An amount of zero or less allocates nothing and returns it as remainder.
 */
export function planAllocation(
  invoices: AllocatableInvoice[],
  amountMinor: MinorUnits,
  options?: AllocationOptions,
): AllocationPlan {
  const available = Math.max(0, Math.trunc(amountMinor));
  // `order` can arrive as an unenforced value such as "manual" from the
  // settings doc; anything that is not newest_first stays oldest-first.
  const newestFirst = options?.order === "newest_first";
  const ordered = invoices
    .filter((invoice) => invoice.balanceMinor > 0)
    .sort((a, b) => {
      const byDue = dueTime(a.dueDate) - dueTime(b.dueDate);
      if (byDue !== 0) return newestFirst ? -byDue : byDue;
      return a.id.localeCompare(b.id);
    });

  const allocations: PlannedAllocation[] = [];
  let remaining = available;

  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amount = Math.min(invoice.balanceMinor, remaining);
    if (amount <= 0) continue;
    allocations.push({ invoiceId: invoice.id, amountMinor: amount });
    remaining -= amount;
  }

  return {
    allocations,
    allocatedMinor: available - remaining,
    remainderMinor: remaining,
  };
}
