import {
  Banknote,
  Building2,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  Settings,
  TrendingUp,
  Users,
  Wrench,
  DoorOpen,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Capability } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** At least one of these capabilities is required to see the item. */
  required: Capability[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        required: ["view_financials"],
      },
    ],
  },
  {
    label: "Portfolio",
    items: [
      {
        href: "/properties",
        label: "Properties",
        icon: Building2,
        required: ["manage_properties", "view_financials"],
      },
      { href: "/units", label: "Units", icon: DoorOpen, required: ["manage_units", "view_financials"] },
      { href: "/tenants", label: "Tenants", icon: Users, required: ["manage_tenants", "view_financials"] },
      { href: "/leases", label: "Leases", icon: ScrollText, required: ["manage_leases", "view_financials"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/invoices", label: "Invoices", icon: FileText, required: ["view_financials"] },
      { href: "/payments", label: "Payments", icon: Banknote, required: ["view_financials"] },
      { href: "/reports", label: "Reports", icon: TrendingUp, required: ["export_reports"] },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: Wrench,
        required: ["manage_maintenance", "update_maintenance"],
      },
      { href: "/sms", label: "SMS", icon: MessageSquare, required: ["manage_sms"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, required: ["manage_settings"] },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const RECEIPT_ICON = Receipt;
