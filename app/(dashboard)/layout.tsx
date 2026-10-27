import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getSessionUser } from "@/lib/auth/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
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
