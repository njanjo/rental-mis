"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";

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
import { APP_NAME } from "@/lib/brand";
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
    <Sidebar
      collapsible="icon"
      variant="inset"
      className="[&>[data-sidebar=sidebar]]:rounded-2xl [&>[data-sidebar=sidebar]]:ring-1 [&>[data-sidebar=sidebar]]:ring-sidebar-border [&>[data-sidebar=sidebar]]:shadow-e1"
    >
      <SidebarHeader className="border-b border-sidebar-border/70 px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={APP_NAME}>
              <Link href="/dashboard">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary ring-1 ring-sidebar-border">
                  <Image
                    src="/icon.svg"
                    alt={APP_NAME}
                    width={36}
                    height={36}
                    className="size-9"
                  />
                </span>
                <span className="flex flex-col gap-1 leading-none">
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {APP_NAME}
                  </span>
                  <span className="label-micro truncate text-[9px]">
                    Kenya property ops
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-1 py-2">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(
            (item) => item.allRoles || canAny(role, item.required),
          );
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={section.label} className="py-1">
              <SidebarGroupLabel className="label-micro h-7 px-2">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
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
                          className="h-9 rounded-lg data-[active=true]:bg-primary/10 data-[active=true]:font-medium data-[active=true]:text-primary hover:bg-sidebar-accent"
                        >
                          <Link href={item.href}>
                            <Icon className="size-4" />
                            <span>{item.label}</span>
                            {active ? (
                              <span
                                aria-hidden
                                className="ml-auto size-1.5 rounded-full bg-primary"
                              />
                            ) : null}
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

      <SidebarFooter className="border-t border-sidebar-border/70 p-2">
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/60 px-2 py-1.5 text-xs text-sidebar-foreground/80 ring-1 ring-sidebar-border/70">
          <ShieldCheck className="size-3.5 shrink-0 text-primary" />
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
