import { cn } from "@/lib/utils";

/**
 * Server-rendered sparkline for KPI cards. Pure SVG, no client JS, no chart
 * library. Values are KES minor units; the path is normalised to the viewBox.
 */
export function Sparkline({
  points,
  width = 88,
  height = 28,
  label,
  className,
}: {
  points: number[];
  width?: number;
  height?: number;
  /** Accessible summary, e.g. "Collections trend, last 6 months". */
  label: string;
  className?: string;
}) {
  const values = points.filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = 100 / (values.length - 1);
  const coords = values.map((value, index) => {
    const x = index * stepX;
    // Invert Y so higher money sits higher in the box.
    const y = 28 - ((value - min) / span) * 24;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const last = values[values.length - 1];
  const rising = last >= values[0];

  return (
    <svg
      viewBox="0 0 100 32"
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={rising ? "stroke-success" : "stroke-danger"}
      />
      <circle
        cx={100}
        cy={coords[coords.length - 1].split(",")[1]}
        r={2.2}
        vectorEffect="non-scaling-stroke"
        className={rising ? "fill-success" : "fill-danger"}
      />
    </svg>
  );
}
