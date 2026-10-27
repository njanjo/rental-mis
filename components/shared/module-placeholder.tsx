import type { LucideIcon } from "lucide-react";
import { CircleDashed } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  phase: string;
  planned: string[];
  docSection: string;
}

export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
  phase,
  planned,
  docSection,
}: ModulePlaceholderProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge variant="outline" className="gap-1.5 font-normal">
            <CircleDashed className="size-3" />
            {phase}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4.5 text-muted-foreground" />
              </span>
              <div>
                <CardTitle className="text-base">Scheduled for {phase}</CardTitle>
                <CardDescription>{docSection}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="mb-3 text-sm text-muted-foreground">
              The route, navigation and access control are in place. These
              capabilities land in the next build phases:
            </p>
            <ul className="space-y-2">
              {planned.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm">Working today</CardTitle>
            <CardDescription>
              Foundation pieces already wired for this module
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>· Route protected by session + role check</p>
            <p>· Sidebar entry filtered by capability</p>
            <p>· Firestore rules deny client writes</p>
            <p>· Typed data model in <span className="font-mono text-xs">lib/types</span></p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
