"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  Clock3Icon,
  HistoryIcon,
  UserPlusIcon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/format";
import type { ScheduleChangeItem, ScheduleChangeKind } from "@/lib/schedule-change-history-types";
import type { CalendarEntry } from "./types";
import { scheduleEventTitleParts } from "./types";

export type ScheduleChangePreviewFilter = "all" | "calendar" | "assignee";

const DAILY_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const FILTER_CONFIG: Record<ScheduleChangePreviewFilter, {
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  icon: typeof CalendarDaysIcon;
  kinds: Set<ScheduleChangeKind>;
  title: string;
  windowMs: number;
}> = {
  all: {
    title: "Recent activity",
    description: "Crew assignments and calendar sync changes, newest first.",
    emptyTitle: "No recent changes",
    emptyDescription: "New assignments and synced calendar updates will appear here.",
    icon: HistoryIcon,
    windowMs: 0,
    kinds: new Set([
      "assignment_assigned",
      "assignment_removed",
      "assignment_updated",
      "pickup_claimed",
      "pickup_requested",
      "published",
      "republished",
      "event_created",
      "event_updated",
      "event_visibility_updated",
    ]),
  },
  calendar: {
    title: "Synced calendar changes",
    description: "Calendar event changes recorded in the last 24 hours.",
    emptyTitle: "No calendar changes",
    emptyDescription: "New or updated calendar events will appear here after the next sync.",
    icon: CalendarDaysIcon,
    windowMs: DAILY_ACTIVITY_WINDOW_MS,
    kinds: new Set(["event_created", "event_updated", "event_visibility_updated"]),
  },
  assignee: {
    title: "Assignee changes",
    description: "Crew and assignee changes recorded in the last 24 hours.",
    emptyTitle: "No assignee changes",
    emptyDescription: "New assignments, removals, and call-time changes will appear here.",
    icon: UserRoundIcon,
    windowMs: DAILY_ACTIVITY_WINDOW_MS,
    kinds: new Set(["assignment_assigned", "assignment_removed", "assignment_updated", "pickup_claimed"]),
  },
};

function recentItems(
  items: ScheduleChangeItem[],
  kinds: Set<ScheduleChangeKind>,
  windowMs: number,
) {
  const cutoff = windowMs > 0 ? Date.now() - windowMs : 0;
  return items
    .filter((item) => kinds.has(item.kind) && (cutoff === 0 || Date.parse(item.createdAt) >= cutoff))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function changeIcon(kind: ScheduleChangeKind) {
  if (kind === "event_created" || kind === "event_updated" || kind === "event_visibility_updated") {
    return CalendarClockIcon;
  }
  if (kind === "assignment_assigned" || kind === "pickup_claimed") return UserPlusIcon;
  if (kind === "assignment_removed") return UserRoundIcon;
  return Clock3Icon;
}

function eventLabel(entry: CalendarEntry | undefined) {
  if (!entry) return "Schedule event";
  return scheduleEventTitleParts(entry).title;
}

function eventDateLabel(entry: CalendarEntry | undefined) {
  if (!entry) return null;
  if (entry.allDay) {
    return new Date(entry.startsAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + " · All day";
  }
  return formatDateTime(entry.startsAt);
}

export function ScheduleChangePreview({
  entries,
  filter,
  items,
  onOpenChange,
  open,
}: {
  entries: CalendarEntry[];
  filter: ScheduleChangePreviewFilter;
  items: ScheduleChangeItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const config = FILTER_CONFIG[filter];
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleItems = recentItems(items, config.kinds, config.windowMs);
  const Icon = config.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {config.title}
            <Badge variant="gray" size="sm" className="tabular-nums">
              {visibleItems.length}
            </Badge>
          </SheetTitle>
          <SheetDescription>{config.description}</SheetDescription>
        </SheetHeader>

        <SheetBody className="px-6 py-5">
          {visibleItems.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 px-6 text-center">
              <Icon className="size-5 text-muted-foreground/70" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">{config.emptyTitle}</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                {config.emptyDescription}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((item) => {
                const entry = entryById.get(item.eventId);
                const ChangeIcon = changeIcon(item.kind);
                const targetLabel = item.target.label ?? (item.detail && item.detail !== "Working copy" ? item.detail : null);
                const workingCopy = item.detail === "Working copy";
                const changeEventLabel = eventLabel(entry);
                const changeEventDate = eventDateLabel(entry);

                return (
                  <article
                    key={`${item.id}:${item.eventId}`}
                    className="flex gap-3 rounded-lg border border-border/50 bg-card p-3 shadow-xs"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ChangeIcon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-semibold">{item.label}</p>
                        {workingCopy ? <Badge variant="gray" size="sm">Working copy</Badge> : null}
                        {item.needsReview ? <Badge variant="orange" size="sm">Needs review</Badge> : null}
                      </div>
                      {targetLabel ? (
                        <p className="mt-1 truncate text-xs text-muted-foreground">{targetLabel}</p>
                      ) : null}
                      <p className="mt-2 truncate text-xs font-medium text-foreground">{changeEventLabel}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {changeEventDate ? `${changeEventDate} · ` : ""}
                        {item.actorName} · {formatDateTime(item.createdAt)}
                      </p>
                      <Link
                        href={`/events/${item.eventId}`}
                        className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open event
                        <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
