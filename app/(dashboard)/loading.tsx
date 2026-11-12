import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level shell so navigation never lands on a blank frame while the
 * server aggregation runs. Mirrors the page header + KPI grid rhythm.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 lg:col-span-3">
          <Skeleton className="h-5 w-52" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
        <div className="rounded-xl border bg-card p-4 lg:col-span-2">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
