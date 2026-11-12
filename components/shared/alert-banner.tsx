import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type BannerTone = "info" | "success" | "warning" | "danger";

const TONES: Record<
  BannerTone,
  { container: string; icon: string; title: string; body: string; Icon: LucideIcon }
> = {
  info: {
    container: "border-info/30 bg-info/5",
    icon: "text-info",
    title: "text-foreground",
    body: "text-muted-foreground",
    Icon: Info,
  },
  success: {
    container: "border-success/30 bg-success/5",
    icon: "text-success",
    title: "text-foreground",
    body: "text-muted-foreground",
    Icon: CircleCheck,
  },
  warning: {
    container: "border-warning/40 bg-warning/10",
    icon: "text-warning",
    title: "text-foreground",
    body: "text-muted-foreground",
    Icon: TriangleAlert,
  },
  danger: {
    container: "border-danger/40 bg-danger/10",
    icon: "text-danger",
    title: "text-foreground",
    body: "text-muted-foreground",
    Icon: CircleAlert,
  },
};

/**
 * Replaces the hand-rolled `border-amber-500/40 bg-amber-500/5` cards that
 * were duplicated across detail pages. Tone comes from semantic tokens only.
 */
export function AlertBanner({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { container, icon, title: titleClass, body, Icon } = TONES[tone];
  const urgent = tone === "warning" || tone === "danger";

  return (
    <div
      role={urgent ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        container,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className={cn("font-medium", titleClass)}>{title}</p> : null}
        {children ? <div className={cn("leading-relaxed", body)}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
