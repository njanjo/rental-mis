import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, CheckCircle2 } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  const showDemoHint = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

  const params = await searchParams;
  const rawNext = params.next ?? "";
  const nextPath =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-950 text-slate-50 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(16,185,129,0.22),transparent_55%),radial-gradient(100%_70%_at_100%_100%,rgba(59,130,246,0.18),transparent_60%)]"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <Building2 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">Rental MIS</p>
            <p className="text-xs text-slate-400">Property operations · Kenya</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              One ledger for rent, arrears and collections.
            </h1>
            <p className="text-sm leading-relaxed text-slate-300">
              M-Pesa and bank transactions reconcile to invoices automatically.
              Anything ambiguous waits in a review queue — never guessed.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-slate-300">
            {[
              "Properties, units, tenants and leases in one place",
              "Idempotent payment reconciliation",
              "SMS receipts and reminders via Beam",
              "Live occupancy and arrears reporting",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          Staff access only. Tenants pay by M-Pesa or bank and receive SMS — no
          portal, no login.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Building2 className="size-4.5" />
              </span>
              <span className="text-sm font-semibold">Rental MIS</span>
            </div>
          </div>

          <div className="mb-8 space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">Staff sign in</h2>
            <p className="text-sm text-muted-foreground">
              Accounts are provisioned by an administrator.
            </p>
          </div>

          <LoginForm nextPath={nextPath} showDemoHint={showDemoHint} />

          <p className="mt-8 text-xs text-muted-foreground">
            Trouble signing in? Contact your administrator to confirm your access
            is active.
          </p>
        </div>
      </main>
    </div>
  );
}
