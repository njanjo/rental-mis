import { Money } from "@/components/shared/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface SeriesRow {
  label: string;
  minor: number;
  sub?: string;
}

/**
 * The accessible table twin of every chart. Server-rendered and always present
 * in the DOM behind the ChartFrame toggle, so the data survives without JS.
 */
export function PointsTable({ rows }: { rows: SeriesRow[] }) {
  return (
    <div className="max-h-60 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right">
                <Money minor={row.minor} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ShareTable({ rows }: { rows: SeriesRow[] }) {
  const total = rows.reduce((sum, row) => sum + Math.max(row.minor, 0), 0);

  return (
    <div className="max-h-60 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>
                <span className="font-medium">{row.label}</span>
                {row.sub ? (
                  <span className="block text-xs text-muted-foreground">
                    {row.sub}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                <Money minor={row.minor} />
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {total <= 0
                  ? "—"
                  : `${Math.round((Math.max(row.minor, 0) / total) * 100)}%`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
