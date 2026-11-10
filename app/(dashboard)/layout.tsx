import { redirect } from "next/navigation";

import { SessionError } from "@/components/auth/session-error";
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
      <AppSidebar role={user.role} fullName={user.fullName} />
      <SidebarInset className="min-w-0">
        <Topbar fullName={user.fullName} email={user.email} role={user.role} />
        <div className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
