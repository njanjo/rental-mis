"use client";

import { usePathname } from "next/navigation";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import type { Role } from "@/lib/types";

export function Topbar({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: Role;
}) {
  const pathname = usePathname();
  const current =
    ALL_NAV_ITEMS.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.label ?? "Rental MIS";

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{current}</span>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          Africa/Nairobi
        </span>
      </div>
      <UserMenu fullName={fullName} email={email} role={role} />
    </header>
  );
}
