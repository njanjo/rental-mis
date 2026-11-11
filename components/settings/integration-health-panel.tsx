import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type {
  ConfigCheck,
  IntegrationHealthReport,
  IntegrationSignals,
} from "@/services/integration-health";

/**
 * Integration health for the settings page: configuration presence per
 * provider, plus bounded live signals from the operations collections.
 * Secret values are never rendered — only whether they exist.
 */

function CheckRow({ check }: { check: ConfigCheck }) {
  return (
    <li className="flex items-start gap-2">
      {check.status === "ok" ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="text-sm">{check.name}</p>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

function ProviderSection({
  title,
  configured,
  badge,
  checks,
}: {
  title: string;
  configured: boolean;
  badge?: ReactNode;
  checks: ConfigCheck[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {configured ? (
          <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <X className="size-4 shrink-0 text-destructive" />
        )}
        <h3 className="text-sm font-medium">{title}</h3>
        {badge}
      </div>
      <ul className="space-y-1.5">
        {checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </ul>
    </section>
  );
}

function SignalTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function SignalsSection({ signals }: { signals: IntegrationSignals }) {
  const lastBank = signals.lastBankSync;

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">Live signals</h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SignalTile
          label="Failed provider events"
          hint="Among the last 30 received"
          value={
            signals.providerEventsTruncated
              ? `${signals.failedProviderEvents}+ recent`
              : String(signals.failedProviderEvents)
          }
        />
        <SignalTile
          label="SMS dead letters"
          value={String(signals.smsDeadLetter)}
        />
        <SignalTile label="Failed SMS" value={String(signals.smsFailed)} />
        <SignalTile
          label="Open unmatched payments"
          value={String(signals.unmatchedOpenCount)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm">Last bank import</p>
          <p className="text-xs text-muted-foreground">
            {lastBank
              ? `${lastBank.bankCode || "Bank"} · ${formatDateTime(lastBank.startedAt)}`
              : "No bank imports yet"}
          </p>
        </div>
        {lastBank ? <StatusBadge status={lastBank.status} /> : null}
      </div>
    </section>
  );
}

export function IntegrationHealthPanel({
  report,
}: {
  report: IntegrationHealthReport;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Integration health</CardTitle>
          <Badge variant="outline" className="font-normal">
            {report.runtime === "emulator" ? "Local emulator" : "Production"}
          </Badge>
        </div>
        <CardDescription>
          Configuration each integration needs, plus live signals from the
          operations collections.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        <div className="grid gap-6 lg:grid-cols-2">
          <ProviderSection
            title="M-Pesa (Daraja)"
            configured={report.mpesa.configured}
            badge={
              <Badge variant="secondary" className="font-normal capitalize">
                {report.mpesa.environment}
              </Badge>
            }
            checks={report.mpesa.checks}
          />
          <ProviderSection
            title="Beam SMS"
            configured={report.beam.configured}
            checks={report.beam.checks}
          />
          <ProviderSection
            title="Firebase"
            configured={report.firebase.configured}
            checks={report.firebase.checks}
          />
          <ProviderSection
            title="Payment routing"
            configured={report.routing.configured}
            checks={report.routing.checks}
          />
        </div>

        <SignalsSection signals={report.signals} />
      </CardContent>
    </Card>
  );
}
