import { redirect } from "next/navigation";

import { SessionError } from "@/components/auth/session-error";
import { IdleLogout } from "@/components/auth/idle-logout";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { resolveSession } from "@/lib/auth/session";

const FAILURE_MESSAGES = {
  "profile-missing":
    "Your sign-in works, but no staff profile exists for this account.",
  inactive: "This staff profile has been deactivated.",
  "unassigned-account":
    "This staff profile is not linked to an account and no default account exists.",
} as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, failure } = await resolveSession();

  if (!user) {
    // No cookie or a rejected cookie is a normal sign-out: send to login.
    if (!failure || failure === "missing" || failure === "invalid") {
      redirect("/login");
    }
    // A valid session that cannot be used gets an explanation, not a loop.
    return <SessionError message={FAILURE_MESSAGES[failure]} />;
  }

  return (
    <SidebarProvider>
      <IdleLogout />
      <AppSidebar role={user.role} fullName={user.fullName} />
      <SidebarInset className="min-w-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-e1">
        <Topbar fullName={user.fullName} email={user.email} role={user.role} />
        <div className="relative isolate flex-1 overflow-hidden">
          <div
            aria-hidden
            className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.18] [mask-image:radial-gradient(70%_55%_at_50%_0%,black,transparent)] dark:opacity-[0.12]"
          />
          <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
