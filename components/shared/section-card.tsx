import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The reporting card shell: one header rhythm for every chart and table.
 * Header borders are drawn once here instead of per page.
 */
export function SectionCard({
  title,
  description,
  actions,
  icon: Icon,
  children,
  footer,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-hairline py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon ? (
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground ring-1 ring-hairline">
              <Icon className="size-3.5" aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base leading-tight">{title}</CardTitle>
            {description ? (
              <CardDescription className="text-xs leading-relaxed">
                {description}
              </CardDescription>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </CardHeader>
      <CardContent className={cn("py-4", contentClassName)}>
        {children}
      </CardContent>
      {footer ? (
        <div className="border-t border-hairline px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
