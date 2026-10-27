"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ShieldCheck } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { canAny } from "@/lib/auth/permissions";
import { NAV_SECTIONS } from "@/lib/navigation";
import { ROLE_LABELS, type Role } from "@/lib/types";

interface AppSidebarProps {
  role: Role;
  fullName: string;
}

export function AppSidebar({ role, fullName }: AppSidebarProps) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border/60 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Rental MIS">
              <Link href="/dashboard">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2 className="size-4" />
                </span>
                <span className="flex flex-col gap-0.5 leading-none">
                  <span className="truncate text-sm font-semibold">Rental MIS</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">
                    Kenya property ops
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => canAny(role, item.required));
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const Icon = item.icon;

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                        >
                          <Link href={item.href}>
                            <Icon className="size-4" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-foreground/70">
          <ShieldCheck className="size-3.5 shrink-0" />
          {collapsed ? null : (
            <span className="truncate">
              {ROLE_LABELS[role]} · {fullName.split(" ")[0]}
            </span>
          )}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
