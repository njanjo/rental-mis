"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { canAny } from "@/lib/auth/permissions";
import { NAV_SECTIONS } from "@/lib/navigation";
import type { Role } from "@/lib/types";

/**
 * Role-filtered module switcher. Server-rendered pages stay server-only; this
 * client island only knows routes and labels. The 21st-style search pill opens
 * the same palette as ⌘K / Ctrl+K.
 */
export function CommandMenu({ role }: { role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.allRoles || canAny(role, item.required),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-2 border-hairline bg-surface/60 pr-1.5 text-muted-foreground hover:text-foreground md:w-56 md:justify-start"
        aria-label="Search or jump to a module"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden md:inline">Search or jump to…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none md:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command menu"
        description="Jump to a module in Boma Cloud."
        className="rounded-2xl"
      >
        <Command>
          <CommandInput placeholder="Jump to a module…" />
          <CommandList>
            <CommandEmpty>Nothing matches that search.</CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.label} heading={section.label}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.href}
                      value={`${item.label} ${section.label}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(item.href);
                      }}
                    >
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                      <span>{item.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
