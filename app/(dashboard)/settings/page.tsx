import type { Metadata } from "next";
import { Users } from "lucide-react";

import { IntegrationHealthPanel } from "@/components/settings/integration-health-panel";
import {
  BillingRulesForm,
  ReminderRulesForm,
  SmsTemplatesForm,
} from "@/components/settings/settings-forms";
import {
  DeactivateStaffButton,
  EditStaffDialog,
  InviteStaffDialog,
  ReactivateStaffButton,
} from "@/components/settings/staff-dialogs";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requireAnyCapability } from "@/lib/auth/session";
import { isServiceError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_SMS_TEMPLATES } from "@/lib/sms";
import { ROLE_LABELS } from "@/lib/types";
import type { StaffListItem } from "@/lib/types/views";
import { EDITABLE_SMS_TEMPLATE_KEYS } from "@/lib/validation/settings";
import { getPropertyOptions } from "@/services/properties";
import { integrationHealth } from "@/services/integration-health";
import { listStaff } from "@/services/staff-admin";
import {
  DEFAULT_BILLING,
  DEFAULT_REMINDERS,
  readSettings,
  type SettingsView,
} from "@/services/settings";

export const metadata: Metadata = { title: "Settings" };

/** DataTable rows key on `id`; staff rows carry their `uid` in both. */
type StaffRow = StaffListItem & { id: string };

/** Defensive fallback — the page guard is admin-only, so this is unreachable. */
const FALLBACK_SETTINGS: SettingsView = {
  timezone: "Africa/Nairobi",
  currency: "KES",
  billing: DEFAULT_BILLING,
  reminders: DEFAULT_REMINDERS,
  templates: EDITABLE_SMS_TEMPLATE_KEYS.map((key) => ({
    key,
    body: DEFAULT_SMS_TEMPLATES[key],
    enabled: true,
  })),
};

export default async function SettingsPage() {
  const user = await requireAnyCapability(["manage_settings"]);
  const canManageStaff = can(user.role, "manage_staff");

  const [settings, staff, propertyOptions, health] = await Promise.all([
    readSettings(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") {
        return FALLBACK_SETTINGS;
      }
      throw error;
    }),
    listStaff(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    getPropertyOptions(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return [];
      throw error;
    }),
    integrationHealth(user).catch((error) => {
      if (isServiceError(error) && error.code === "forbidden") return null;
      throw error;
    }),
  ]);

  const staffRows: StaffRow[] = staff.map((member) => ({
    ...member,
    id: member.uid,
  }));

  const columns: DataTableColumn<StaffRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (member) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{member.fullName}</span>
          <span className="text-xs text-muted-foreground">{member.email}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (member) => <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>,
      className: "w-44",
    },
    {
      key: "properties",
      header: "Properties",
      cell: (member) => (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {member.role === "admin"
            ? "All properties"
            : member.propertyNames.length > 0
              ? member.propertyNames.join(", ")
              : "—"}
        </span>
      ),
      className: "hidden lg:table-cell",
      headerClassName: "hidden lg:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (member) => (
        <StatusBadge status={member.active ? "active" : "inactive"} />
      ),
      className: "w-24",
    },
    {
      key: "lastSignInAt",
      header: "Last sign-in",
      cell: (member) => (
        <span className="text-xs text-muted-foreground">
          {member.lastSignInAt ? formatDateTime(member.lastSignInAt) : "Never"}
        </span>
      ),
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "actions",
      header: "",
      cell: (member) => (
        <div className="flex justify-end gap-2">
          <EditStaffDialog staff={member} propertyOptions={propertyOptions} />
          {member.uid === user.uid ? null : member.active ? (
            <DeactivateStaffButton staff={member} />
          ) : (
            <ReactivateStaffButton staff={member} />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Staff roles, billing rules, SMS templates and integration health."
        actions={
          canManageStaff ? (
            <InviteStaffDialog propertyOptions={propertyOptions} />
          ) : null
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Staff</h2>
        <DataTable
          columns={columns}
          rows={staffRows}
          empty={
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="You are the first administrator — invite colleagues to help manage properties, rent and maintenance."
              action={
                canManageStaff ? (
                  <InviteStaffDialog propertyOptions={propertyOptions} />
                ) : null
              }
            />
          }
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Billing rules</CardTitle>
            <CardDescription>
              Allocation order, overpayment policy and invoice timing.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <BillingRulesForm defaults={settings.billing} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Reminder windows</CardTitle>
            <CardDescription>
              When rent reminders go out and how often arrears notices repeat.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ReminderRulesForm defaults={settings.reminders} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-base">SMS templates</CardTitle>
            <CardDescription>
              The messages Beam sends for receipts, due dates and arrears.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <SmsTemplatesForm templates={settings.templates} />
          </CardContent>
        </Card>
      </div>

      {health ? (
        <div className="mt-6">
          <IntegrationHealthPanel report={health} />
        </div>
      ) : null}
    </>
  );
}
