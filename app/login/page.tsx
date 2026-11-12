import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { AlertBanner } from "@/components/shared/alert-banner";
import { defaultLandingPath } from "@/lib/auth/landing";
import { APP_NAME } from "@/lib/brand";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const rawNext = params.next ?? "";
  const nextPath =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
  const showInactiveNotice = params.reason === "inactive";

  const user = await getSessionUser();
  if (user) {
    redirect(nextPath ?? defaultLandingPath(user.role));
  }

  const showDemoHint = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-panel text-brand-panel-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="aurora pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 opacity-[0.14]"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-panel-foreground/10 ring-1 ring-brand-panel-foreground/15">
                <Image
                  src="/icon.svg"
                  alt={APP_NAME}
                  width={40}
                  height={40}
                  className="size-10"
                />
              </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">{APP_NAME}</p>
            <p className="text-xs text-brand-panel-foreground/55">Property operations · Kenya</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              One ledger for rent, arrears and collections.
            </h1>
            <p className="text-sm leading-relaxed text-brand-panel-foreground/70">
              M-Pesa and bank transactions reconcile to invoices automatically.
              Anything ambiguous waits in a review queue — never guessed.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-brand-panel-foreground/70">
            {[
              "Properties, units, tenants and leases in one place",
              "Idempotent payment reconciliation",
              "SMS receipts and reminders via Beam",
              "Live occupancy and arrears reporting",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-on-dark" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-panel-foreground/40">
          Staff access only. Tenants pay by M-Pesa or bank and receive SMS — no
          portal, no login.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Image
                  src="/icon.svg"
                  alt={APP_NAME}
                  width={36}
                  height={36}
                  className="size-9"
                />
              </span>
              <span className="text-sm font-semibold">{APP_NAME}</span>
            </div>
          </div>

          {showInactiveNotice ? (
            <AlertBanner tone="info" className="mb-6">
              You were signed out after 10 minutes of inactivity. Sign in
              again to continue.
            </AlertBanner>
          ) : null}

          <div className="mb-8 space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">Staff sign in</h2>
            <p className="text-sm text-muted-foreground">
              Accounts are provisioned by an administrator.
            </p>
          </div>

          <LoginForm nextPath={nextPath ?? "/dashboard"} showDemoHint={showDemoHint} />

          <p className="mt-8 text-xs text-muted-foreground">
            Forgot your password? Contact your administrator to reset it.
          </p>
        </div>
      </main>
    </div>
  );
}
