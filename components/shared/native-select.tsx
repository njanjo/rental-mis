import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Styled native select. Native keeps keyboard, mobile and no-JS behaviour for
 * free; the Radix select is reserved for richer pickers.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { NativeSelect };
