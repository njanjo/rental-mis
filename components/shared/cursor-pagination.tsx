import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

type ParamValue = string | string[] | undefined;

function buildHref(
  basePath: string,
  params: Record<string, ParamValue>,
  cursor?: string,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) search.set(key, first);
  }
  if (cursor) search.set("cursor", cursor);
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Cursor pagination. "Next" carries the cursor Firestore returned; "First"
 * drops it. Cursors are opaque, so no page numbers are shown.
 */
export function CursorPagination({
  basePath,
  params,
  nextCursor,
  hasCursor,
}: {
  basePath: string;
  params: Record<string, ParamValue>;
  nextCursor: string | null;
  hasCursor: boolean;
}) {
  if (!nextCursor && !hasCursor) return null;

  return (
    <div className="flex items-center justify-between gap-2 pt-4">
      <p className="text-xs text-muted-foreground">
        {nextCursor ? "More records available" : "End of results"}
      </p>
      <div className="flex items-center gap-2">
        {hasCursor ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildHref(basePath, params)}>
              <ChevronLeft className="size-4" />
              First page
            </Link>
          </Button>
        ) : null}
        {nextCursor ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildHref(basePath, params, nextCursor)}>
              Next
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
