"use client";

import { usePathname } from "next/navigation";

import { CommandMenu } from "@/components/layout/command-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { APP_NAME } from "@/lib/brand";
import { ALL_NAV_ITEMS, NAV_SECTIONS } from "@/lib/navigation";
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
    ) ?? null;
  const section = current
    ? NAV_SECTIONS.find((group) => group.items.includes(current))?.label
    : null;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-background/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="min-w-0 flex-1">
        <p className="label-micro truncate leading-none">
          {section ?? "Boma Cloud"}
        </p>
        <span className="block truncate text-sm font-medium leading-tight">
          {current?.label ?? APP_NAME}
        </span>
      </div>
      <CommandMenu role={role} />
      <ThemeToggle />
      <UserMenu fullName={fullName} email={email} role={role} />
    </header>
  );
}
