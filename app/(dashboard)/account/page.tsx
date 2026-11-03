import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/types";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Your profile and password. Roles and property scope are managed by an
          administrator.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
          <CardDescription>Read-only — changes go through provisioning.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Full name</span>
            <span className="font-medium">{user.fullName}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user.email}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Property scope</span>
            <span className="font-medium">
              {user.role === "admin"
                ? "All properties"
                : user.propertyIds.length
                  ? `${user.propertyIds.length} assigned`
                  : "None assigned"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="size-4" />
            Password
          </CardTitle>
          <CardDescription>
            Change your password using Firebase Authentication.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Password management is handled by Firebase.</p>
        </CardContent>
      </Card>
    </div>
  );
}
