import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Label + control + inline error, used by every module form. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string[];
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-sm font-medium leading-none"
      >
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
      {hint && !error?.length ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {error?.length ? (
        <p className="text-xs text-destructive" role="alert">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}
