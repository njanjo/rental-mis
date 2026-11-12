"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";

import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";

/**
 * The only client island in the reporting stack. It swaps a server-rendered
 * chart for its data-table equivalent — the accessibility fallback, not an
 * interactive charting engine. Charts themselves stay server SVG.
 */
export function ChartFrame({
  title,
  description,
  actions,
  chart,
  table,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  chart: ReactNode;
  /** Server-rendered table with the same data; required, not optional. */
  table: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <SectionCard
      title={title}
      description={description}
      className={className}
      footer={footer}
      actions={
        <>
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-pressed={view === "table"}
            aria-label={view === "chart" ? "View as table" : "View as chart"}
            onClick={() => setView((current) => (current === "chart" ? "table" : "chart"))}
          >
            {view === "chart" ? (
              <Table2 className="size-3.5" />
            ) : (
              <BarChart3 className="size-3.5" />
            )}
          </Button>
        </>
      }
    >
      {view === "chart" ? chart : table}
    </SectionCard>
  );
}
