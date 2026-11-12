import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
}

/**
 * Presentational table. Sorting and pagination happen on the server; this
 * component only lays rows out consistently across every module.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-hairline bg-card shadow-e1",
          className,
        )}
      >
        {empty}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-hairline bg-card shadow-e1",
        className,
      )}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-hairline bg-muted/50 hover:bg-muted/50">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn("label-micro h-10 text-muted-foreground!", column.headerClassName)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="border-b border-hairline transition-colors last:border-0 hover:bg-muted/40"
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn("py-3", column.className)}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
