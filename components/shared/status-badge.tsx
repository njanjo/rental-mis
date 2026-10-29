import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = {
  label: string;
  className: string;
};

const TONES: Record<string, Tone> = {
  // generic
  active: { label: "Active", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  inactive: { label: "Inactive", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  former: { label: "Former", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  archived: { label: "Archived", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  // units
  vacant: { label: "Vacant", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  occupied: { label: "Occupied", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  maintenance: { label: "Maintenance", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  // leases
  pending: { label: "Pending", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  expired: { label: "Expired", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  terminated: { label: "Terminated", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  // maintenance
  open: { label: "Open", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  assigned: { label: "Assigned", className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  in_progress: { label: "In progress", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  resolved: { label: "Resolved", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  // invoices
  partial: { label: "Part paid", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  paid: { label: "Paid", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  overdue: { label: "Overdue", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  void: { label: "Void", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  // payments
  received: { label: "Received", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  confirmed: { label: "Confirmed", className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  allocated: { label: "Allocated", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  unmatched: { label: "Unmatched", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  rejected: { label: "Rejected", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  reversed: { label: "Reversed", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  reversal: { label: "Reversal", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  ignored: { label: "Ignored", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  // priority
  low: { label: "Low", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  medium: { label: "Medium", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  high: { label: "High", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  urgent: { label: "Urgent", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  // sms
  queued: { label: "Queued", className: "bg-amber-500/10 text-amber-700 dark:text-amber-500" },
  sending: { label: "Sending", className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" },
  sent: { label: "Sent", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  delivered: { label: "Delivered", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  failed: { label: "Failed", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  dead_letter: { label: "Dead letter", className: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
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
      className={cn("border-transparent font-normal", tone.className, className)}
    >
      {tone.label}
    </Badge>
  );
}
