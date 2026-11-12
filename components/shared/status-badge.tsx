import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = {
  label: string;
  className: string;
};

const TONES: Record<string, Tone> = {
  // generic
  active: { label: "Active", className: "bg-success/10 text-success" },
  inactive: { label: "Inactive", className: "bg-state-neutral/10 text-state-neutral" },
  former: { label: "Former", className: "bg-state-neutral/10 text-state-neutral" },
  archived: { label: "Archived", className: "bg-state-neutral/10 text-state-neutral" },
  // units
  vacant: { label: "Vacant", className: "bg-info/10 text-info" },
  occupied: { label: "Occupied", className: "bg-success/10 text-success" },
  maintenance: { label: "Maintenance", className: "bg-warning/10 text-warning" },
  // leases
  pending: { label: "Pending", className: "bg-warning/10 text-warning" },
  expired: { label: "Expired", className: "bg-state-neutral/10 text-state-neutral" },
  terminated: { label: "Terminated", className: "bg-danger/10 text-danger" },
  // maintenance
  open: { label: "Open", className: "bg-info/10 text-info" },
  assigned: { label: "Assigned", className: "bg-info/10 text-info" },
  in_progress: { label: "In progress", className: "bg-warning/10 text-warning" },
  resolved: { label: "Resolved", className: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", className: "bg-state-neutral/10 text-state-neutral" },
  // invoices
  partial: { label: "Part paid", className: "bg-warning/10 text-warning" },
  paid: { label: "Paid", className: "bg-success/10 text-success" },
  overdue: { label: "Overdue", className: "bg-danger/10 text-danger" },
  void: { label: "Void", className: "bg-state-neutral/10 text-state-neutral" },
  // payments
  received: { label: "Received", className: "bg-info/10 text-info" },
  confirmed: { label: "Confirmed", className: "bg-info/10 text-info" },
  allocated: { label: "Allocated", className: "bg-success/10 text-success" },
  unmatched: { label: "Unmatched", className: "bg-warning/10 text-warning" },
  rejected: { label: "Rejected", className: "bg-danger/10 text-danger" },
  reversed: { label: "Reversed", className: "bg-danger/10 text-danger" },
  reversal: { label: "Reversal", className: "bg-danger/10 text-danger" },
  ignored: { label: "Ignored", className: "bg-state-neutral/10 text-state-neutral" },
  // priority
  low: { label: "Low", className: "bg-state-neutral/10 text-state-neutral" },
  medium: { label: "Medium", className: "bg-info/10 text-info" },
  high: { label: "High", className: "bg-warning/10 text-warning" },
  urgent: { label: "Urgent", className: "bg-danger/10 text-danger" },
  // sms
  queued: { label: "Queued", className: "bg-warning/10 text-warning" },
  sending: { label: "Sending", className: "bg-info/10 text-info" },
  sent: { label: "Sent", className: "bg-info/10 text-info" },
  delivered: { label: "Delivered", className: "bg-success/10 text-success" },
  failed: { label: "Failed", className: "bg-danger/10 text-danger" },
  dead_letter: { label: "Dead letter", className: "bg-danger/10 text-danger" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = TONES[status];
  if (!tone) {
    return (
      <Badge variant="secondary" className={cn("font-normal capitalize", className)}>
        {status.replace(/_/g, " ")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 border-hairline font-normal tabular-nums",
        tone.className,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {tone.label}
    </Badge>
  );
}
