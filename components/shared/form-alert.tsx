import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormState } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Inline result banner for a server action. */
export function FormAlert({
  state,
  className,
}: {
  state: FormState;
  className?: string;
}) {
  if (state.status === "idle" || !state.message) return null;

  if (state.status === "success") {
    return (
      <Alert className={cn("border-emerald-500/30 bg-emerald-500/5", className)}>
        <CircleCheck className="size-4 text-emerald-600" />
        <AlertDescription className="text-emerald-800 dark:text-emerald-300">
          {state.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className={className}>
      <CircleAlert className="size-4" />
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}
