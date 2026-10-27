"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Submit button wired to the enclosing form's pending state. */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
