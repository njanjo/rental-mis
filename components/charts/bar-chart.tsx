import { formatMoney, formatMoneyCompact } from "@/lib/format";

export interface BarPoint {
  label: string;
  minor: number;
  /** Optional caption under the bar (e.g. invoice count). */
  sub?: string;
}

/**
 * Vertical column chart rendered as plain flex + div heights — no chart
 * library, no client JS. Values are expected as KES minor units; every bar
 * carries its exact amount via the `title` attribute.
 */
export function ColumnChart({ points }: { points: BarPoint[] }) {
  const max = Math.max(...points.map((point) => point.minor), 0);
  if (max <= 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No income in this period yet.
      </p>
    );
  }

  return (
    <div className="flex h-40 items-end gap-1.5">
      {points.map((point) => {
        // Keep the shortest visible bar at 4% so trace amounts still show.
        const heightPct = Math.max((point.minor / max) * 96, 4);
        return (
          <div
            key={point.label}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={`${point.label}: ${formatMoney(point.minor)}`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md bg-primary/80"
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className="w-full truncate text-center text-[10px] text-muted-foreground">
              {point.sub ?? point.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Horizontal share bars for hierarchies (properties, channels). Sorted data is
 * expected; rendered top-down with the share as bar width.
 */
export function ShareBars({ points }: { points: BarPoint[] }) {
  const max = Math.max(...points.map((point) => point.minor), 0);
  if (max <= 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Nothing recorded in this period.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {points.map((point) => (
        <li key={point.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{point.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatMoneyCompact(point.minor)}
            </span>
          </div>
          <div
            className="mt-1 h-2 rounded-full bg-muted"
            title={`${point.label}: ${formatMoney(point.minor)}`}
          >
            <div
              className="h-full rounded-full bg-sky-500/80"
              style={{
                width: `${Math.max((point.minor / max) * 100, 1.5)}%`,
              }}
            />
          </div>
          {point.sub ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{point.sub}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
