import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatDelta {
  direction: "up" | "down" | "flat";
  /** Fractional change (0.12 = +12%). Null when there is no prior period. */
  percent: number | null;
  /** Whether the move is good for the business; null when flat/unknown. */
  good: boolean | null;
  /** Defaults to "vs previous period". */
  label?: string;
}

const PERCENT = new Intl.NumberFormat("en-KE", {
  style: "percent",
  maximumFractionDigits: 1,
});

function DeltaChip({ delta }: { delta: StatDelta }) {
  const Icon =
    delta.direction === "up"
      ? ArrowUpRight
      : delta.direction === "down"
        ? ArrowDownRight
        : Minus;

  const tone =
    delta.good === null
      ? "text-muted-foreground"
      : delta.good
        ? "text-success"
        : "text-danger";

  const spoken =
    delta.direction === "flat"
      ? "no change"
      : `${delta.direction === "up" ? "up" : "down"} ${
          delta.percent === null ? "" : PERCENT.format(Math.abs(delta.percent))
        }`.trim();

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium", tone)}
      title={delta.label ?? "vs previous period"}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">
        {delta.percent === null ? "—" : PERCENT.format(Math.abs(delta.percent))}
      </span>
      <span className="sr-only"> {spoken}</span>
    </span>
  );
}

/**
 * A KPI is never a naked number: it carries its period context (hint), a
 * comparison (delta), an optional target/sparkline slot, and a drill-down.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  href,
  delta,
  footer,
  sparkline,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  delta?: StatDelta;
  footer?: ReactNode;
  sparkline?: ReactNode;
  className?: string;
}) {
  const body = (
    <Card
      className={cn(
        "h-full gap-0 py-0 transition-colors",
        href && "hover:bg-accent/40 hover:ring-primary/40",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-3.5 pb-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
      </CardHeader>
      <CardContent className="px-4 pt-1.5 pb-3.5">
        <div className="flex items-end justify-between gap-3">
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {sparkline ? <div className="shrink-0">{sparkline}</div> : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {delta ? <DeltaChip delta={delta} /> : null}
          {hint ? <span className="truncate">{hint}</span> : null}
        </div>
        {footer ? <div className="mt-2">{footer}</div> : null}
      </CardContent>
    </Card>
  );

  if (!href) return body;

  return (
    <Link
      href={href}
      className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {body}
    </Link>
  );
}
