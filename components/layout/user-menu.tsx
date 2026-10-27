"use client";

import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/providers/auth-provider";
import { initials } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/types";

export function UserMenu({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: Role;
}) {
  const { signOut } = useAuth();

  async function handleSignOut() {
    try {
      await signOut();
    } catch {
      toast.error("Could not sign out. Try again.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 pr-2.5"
          aria-label="Account menu"
        >
          <Avatar className="size-6">
            <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
              {initials(fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm sm:inline">{fullName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-1 font-normal">
          <div className="flex items-center gap-2">
            <UserRound className="size-3.5 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{fullName || "Staff"}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <Badge variant="secondary" className="mt-1 font-normal">
            {ROLE_LABELS[role]}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
