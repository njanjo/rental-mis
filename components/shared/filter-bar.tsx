"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/lib/types/views";

export interface FilterDefinition {
  key: string;
  label: string;
  options: SelectOption[];
  /** Include an "All" entry. Defaults to true. */
  allowAll?: boolean;
}

/**
 * URL-driven filters. Every module keeps its state in search params so filters
 * survive refreshes and can be shared. Pagination resets on any change.
 */
export function FilterBar({
  searchKey = "q",
  searchPlaceholder = "Search…",
  filters = [],
  className,
}: {
  searchKey?: string;
  searchPlaceholder?: string;
  filters?: FilterDefinition[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const currentQuery = searchParams.get(searchKey) ?? "";
  const [query, setQuery] = useState(currentQuery);

  // Keep the box in sync when the URL changes externally (e.g. "Clear").
  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    if (query === currentQuery) return;
    const timer = setTimeout(() => {
      navigate((params) => {
        if (query.trim()) params.set(searchKey, query.trim());
        else params.delete(searchKey);
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentQuery, searchKey]);

  const hasFilters =
    Boolean(currentQuery) ||
    filters.some((filter) => Boolean(searchParams.get(filter.key)));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 pl-8"
          aria-label={searchPlaceholder}
          disabled={pending}
        />
      </div>

      {filters.map((filter) => (
        <select
          key={filter.key}
          aria-label={filter.label}
          className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          value={searchParams.get(filter.key) ?? ""}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            navigate((params) => {
              if (value) params.set(filter.key, value);
              else params.delete(filter.key);
            });
          }}
        >
          {filter.allowAll === false ? null : (
            <option value="">{filter.label}: all</option>
          )}
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() =>
            navigate((params) => {
              params.delete(searchKey);
              filters.forEach((filter) => params.delete(filter.key));
            })
          }
        >
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
