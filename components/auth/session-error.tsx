"use client";

import { LogOut, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/providers/auth-provider";

/**
 * Shown when a session exists but cannot be used (profile deactivated, missing,
 * or not linked to an account). Without this the layout silently redirects to
 * /login and the user sees a sign-in loop with no explanation.
 */
export function SessionError({ message }: { message: string }) {
  const { signOut } = useAuth();

  return (
    <main className="flex min-h-svh items-center justify-center px-5 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="size-5 text-destructive" />
            Cannot open the dashboard
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You are signed in, but this profile cannot be used yet. Contact your
            administrator to activate it or link it to an account, then sign in
            again.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              void signOut();
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
