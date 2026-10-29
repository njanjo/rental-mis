"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";

/**
 * Keeps the dashboard honest between visits: re-fetches the server component
 * tree on an interval. Realtime numbers read through the Admin SDK on the
 * server (client SDK listeners would be blocked by rules for scoped roles),
 * so a periodic RSC refresh is the simplest live view with no extra plumbing.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(interval);
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Activity className="size-3.5 animate-pulse text-emerald-600" />
      Auto-refreshes every {seconds}s
    </span>
  );
}
