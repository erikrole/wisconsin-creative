"use client";

import { ChevronDownIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type FormSectionProps = {
  title: string;
  badge?: string;
  badgeVariant?: BadgeProps["variant"];
  description?: string;
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function FormSection({
  title,
  badge,
  badgeVariant = "secondary",
  description,
  collapsible = false,
  open,
  onOpenChange,
  children,
}: FormSectionProps) {
  const headingBody = (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {badge && (
          <Badge variant={badgeVariant} size="sm">
            {badge}
          </Badge>
        )}
      </span>
      {description && (
        <span className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      )}
    </span>
  );

  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <section className="rounded-xl border border-border/50 bg-background/90 shadow-xs">
          <h3>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="group h-auto min-h-14 w-full justify-start whitespace-normal rounded-xl px-4 py-3 hover:bg-muted/35"
              >
                {headingBody}
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </Button>
            </CollapsibleTrigger>
          </h3>
          <CollapsibleContent>
            <div className="flex flex-col gap-4 border-t border-border/50 p-4">
              {children}
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/50 bg-background/90 p-4 shadow-xs">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {badge && (
            <Badge variant={badgeVariant} size="sm">
              {badge}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
