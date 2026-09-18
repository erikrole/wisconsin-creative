"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2Icon, ChevronDownIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type OperationalStatusTone = "critical" | "warning" | "info" | "neutral";

export type OperationalStatusRailItem = {
  id: string;
  label: string;
  value?: number | string;
  detail?: string;
  icon: LucideIcon;
  tone: OperationalStatusTone;
  href?: string;
  onSelect?: () => void;
  scope?: string;
};

export type OperationalStatusRailOrientation = {
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
};

const TONE_RANK: Record<OperationalStatusTone, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  neutral: 3,
};

const TONE_VARIANT: Record<OperationalStatusTone, BadgeProps["variant"]> = {
  critical: "red",
  warning: "orange",
  info: "blue",
  neutral: "outline",
};

function StatusItem({ item }: { item: OperationalStatusRailItem }) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {item.value !== undefined ? (
        <span className="font-bold tabular-nums">{item.value}</span>
      ) : null}
      {item.scope ? <span className="hidden opacity-75 2xl:inline">· {item.scope}</span> : null}
    </>
  );
  const className = cn(
    "h-10 max-w-full min-w-0 rounded-md border px-2.5 py-0 text-xs font-medium shadow-none",
    (item.href || item.onSelect) && "cursor-pointer active:scale-[0.96]",
  );

  const status = item.href ? (
    <Badge asChild variant={TONE_VARIANT[item.tone]} className={className}>
      <Link href={item.href}>{content}</Link>
    </Badge>
  ) : item.onSelect ? (
    <Badge asChild variant={TONE_VARIANT[item.tone]} className={className}>
      <button type="button" onClick={item.onSelect}>{content}</button>
    </Badge>
  ) : (
    <Badge variant={TONE_VARIANT[item.tone]} className={className}>
      {content}
    </Badge>
  );

  if (!item.detail) return status;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{status}</TooltipTrigger>
      <TooltipContent>{item.detail}</TooltipContent>
    </Tooltip>
  );
}

export function OperationalStatusRail({
  allClearLabel,
  className,
  defaultOpen = false,
  details,
  detailsLabel = "Details",
  feed,
  items,
  maxVisibleItems = 3,
  notice,
  orientation,
}: {
  allClearLabel?: string;
  className?: string;
  defaultOpen?: boolean;
  details?: ReactNode;
  detailsLabel?: string;
  feed?: ReactNode;
  items: OperationalStatusRailItem[];
  maxVisibleItems?: number;
  notice?: ReactNode;
  orientation?: OperationalStatusRailOrientation;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const prioritizedItems = useMemo(
    () => items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] || a.index - b.index)
      .map(({ item }) => item),
    [items],
  );
  const visibleItems = prioritizedItems.slice(0, maxVisibleItems);
  const hiddenCount = Math.max(0, prioritizedItems.length - visibleItems.length);
  const OrientationIcon = orientation?.icon;
  const orientationContent = orientation && OrientationIcon ? (
    <>
      <OrientationIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{orientation.label}</span>
      <span className="truncate font-semibold text-foreground">{orientation.value}</span>
    </>
  ) : null;

  return (
    <section className={cn("border-y border-border/50", className)}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className={cn(
          "flex flex-col gap-2 px-1 py-2 lg:flex-row",
          feed ? "lg:items-start" : "lg:items-center",
        )}>
          {orientation?.href ? (
            <Link
              href={orientation.href}
              className="flex h-10 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm no-underline transition-[background-color,color,scale] hover:bg-muted/55 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {orientationContent}
            </Link>
          ) : orientation ? (
            <div className="flex h-10 min-w-0 items-center gap-1.5 px-2 text-sm">
              {orientationContent}
            </div>
          ) : null}

          {orientation ? <Separator orientation="vertical" className="hidden h-5 lg:block" /> : null}

          {feed ? (
            <div className="min-w-0 flex-1">{feed}</div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {visibleItems.length > 0 ? (
                visibleItems.map((item) => <StatusItem key={item.id} item={item} />)
              ) : allClearLabel ? (
                <span className="inline-flex h-10 items-center gap-1.5 px-2 text-sm text-muted-foreground">
                  <CheckCircle2Icon className="size-4" aria-hidden="true" />
                  {allClearLabel}
                </span>
              ) : null}
            </div>
          )}

          {details ? (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="self-end px-2.5 text-xs font-semibold text-muted-foreground lg:self-auto"
                aria-label={open
                  ? `Hide ${detailsLabel.toLowerCase()}`
                  : hiddenCount > 0
                    ? `Show ${detailsLabel.toLowerCase()} and ${hiddenCount} more statuses`
                    : `Show ${detailsLabel.toLowerCase()}`}
              >
                {detailsLabel}
                {hiddenCount > 0 ? <Badge variant="gray" size="sm">+{hiddenCount}</Badge> : null}
                <ChevronDownIcon
                  data-icon="inline-end"
                  className={cn("transition-transform", open && "rotate-180")}
                  aria-hidden="true"
                />
              </Button>
            </CollapsibleTrigger>
          ) : null}
        </div>

        {notice ? <div className="px-3 pb-3">{notice}</div> : null}

        {details ? (
          <CollapsibleContent>
            <Separator />
            <div className="px-3 py-3">{details}</div>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </section>
  );
}
