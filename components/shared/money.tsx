import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

type MoneyTone = "default" | "positive" | "negative" | "muted";

const TONE: Record<MoneyTone, string> = {
  default: "text-foreground",
  positive: "text-success",
  negative: "text-danger",
  muted: "text-muted-foreground",
};

/**
 * Every amount in the product renders through this component so money keeps
 * one visual grammar: Geist Mono, tabular figures, sign-aware tone, and the
 * exact value available in a title even when compacted.
 */
export function Money({
  minor,
  compact = false,
  signed = false,
  tone = "default",
  className,
}: {
  minor: number;
  compact?: boolean;
  /** Prefix a positive amount with "+" (used for deltas, not balances). */
  signed?: boolean;
  tone?: MoneyTone;
  className?: string;
}) {
  const resolved: MoneyTone =
    tone === "default" && minor < 0 ? "negative" : tone;
  const text = compact ? formatMoneyCompact(minor) : formatMoney(minor);

  return (
    <span
      className={cn("font-mono tabular-nums", TONE[resolved], className)}
      title={formatMoney(minor)}
    >
      {signed && minor > 0 ? `+${text}` : text}
    </span>
  );
}
