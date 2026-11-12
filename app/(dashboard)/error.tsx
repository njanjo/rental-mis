"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A failed aggregation should explain itself and offer a safe retry, not show
 * the Next.js production error shell.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the browser console; the server log has the stack.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-danger/10">
        <TriangleAlert className="size-5 text-danger" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">This page could not load</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The data request failed before it finished. Retrying is safe — nothing
          is written by a page render.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        <RotateCcw className="size-4" />
        Try again
      </Button>
    </div>
  );
}
