"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Clock3,
  History,
  Package,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatRelativeTime } from "@/lib/format";
import { calendarSourcePublicLabel } from "@/lib/schedule-event-identity";
import type { ScheduleChangeItem, ScheduleChangeKind } from "@/lib/schedule-change-history-types";
import type { CalendarEvent } from "../_utils";
import {
  type ActivityFilter,
  type DescribedScheduleChange,
  coalesceScheduleChanges,
  groupActivityByDate,
} from "../_activity";

const FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "crew", label: "Crew" },
  { id: "calendar", label: "Calendar" },
  { id: "gear", label: "Gear" },
];

function changeIcon(kind: ScheduleChangeKind) {
  if (kind === "event_created" || kind === "event_updated" || kind === "event_visibility_updated") {
    return CalendarClock;
  }
  if (kind === "reservation_linked") return Package;
  if (kind === "assignment_assigned" || kind === "pickup_claimed") return UserPlus;
  if (kind === "assignment_removed" || kind === "pickup_requested") return UserRound;
  if (kind === "published" || kind === "republished" || kind === "copy_forward_applied") return Users;
  return Clock3;
}

function changeTimeLabel(iso: string, now: Date) {
  const created = new Date(iso);
  const exact = created.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const ageMs = now.getTime() - created.getTime();
  const relative = ageMs < 7 * 24 * 60 * 60 * 1000
    ? formatRelativeTime(iso, now)
    : created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { relative, exact };
}

function ActivityRow({ item, now }: { item: DescribedScheduleChange; now: Date }) {
  const Icon = changeIcon(item.kind);
  const time = changeTimeLabel(item.createdAt, now);
  return (
    <article className="flex gap-3">
      <div className="flex w-8 shrink-0 flex-col items-center self-stretch">
        <div className="mt-0.5 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
        </div>
        <div className="mt-1 w-px flex-1 bg-border/50" />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{item.headline}</p>
          {item.repeatCount && item.repeatCount > 1 ? (
            <Badge variant="gray" size="sm" className="tabular-nums">×{item.repeatCount}</Badge>
          ) : null}
          {item.draft ? <Badge variant="gray" size="sm">Draft</Badge> : null}
          {item.showReview ? <Badge variant="orange" size="sm">Needs review</Badge> : null}
          <time
            dateTime={item.createdAt}
            title={time.exact}
            className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {time.relative}
          </time>
        </div>
        {item.supporting ? (
          <p className="mt-0.5 text-pretty text-sm text-muted-foreground">{item.supporting}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.actorLabel}
          <span className="text-muted-foreground/70"> · {time.exact}</span>
        </p>
      </div>
    </article>
  );
}

export function EventActivityCard({
  recentChanges,
  event,
  showRawSource,
  loading = false,
}: {
  recentChanges: ScheduleChangeItem[];
  event: CalendarEvent;
  showRawSource: boolean;
  loading?: boolean;
}) {
  const sourceLabel = calendarSourcePublicLabel(event.source) ?? "Calendar";
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const now = new Date();
  const changes = useMemo(
    () => coalesceScheduleChanges(recentChanges, sourceLabel),
    [recentChanges, sourceLabel],
  );
  const visible = filter === "all" ? changes : changes.filter((change) => change.filter === filter);
  const groups = groupActivityByDate(visible, now);
  const reviewCount = changes.filter((change) => change.showReview).length;
  const counts = {
    all: changes.length,
    crew: changes.filter((change) => change.filter === "crew").length,
    calendar: changes.filter((change) => change.filter === "calendar").length,
    gear: changes.filter((change) => change.filter === "gear").length,
  };

  return (
    <Card elevation="flat" className="border-border/50 shadow-xs">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Activity</CardTitle>
          {reviewCount > 0 ? (
            <Badge variant="orange" size="sm">{reviewCount} need review</Badge>
          ) : counts.all > 0 ? (
            <Badge variant="gray" size="sm" className="tabular-nums">{counts.all}</Badge>
          ) : null}
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as ActivityFilter);
          }}
          className="w-fit"
          aria-label="Filter activity"
        >
          {FILTERS.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              disabled={option.id !== "all" && counts[option.id] === 0}
              className="min-h-10 px-3"
            >
              {option.label}
              {counts[option.id] > 0 ? (
                <span className="ml-1 tabular-nums text-muted-foreground">{counts[option.id]}</span>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex flex-col gap-3 py-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Empty className="border border-dashed border-border/60 py-8">
            <EmptyHeader>
              <History className="size-5 text-muted-foreground" aria-hidden />
              <EmptyTitle className="text-base">
                {changes.length === 0 ? "No activity yet" : `No ${filter} activity`}
              </EmptyTitle>
              <EmptyDescription>
                {changes.length === 0
                  ? "Assignments, publishes, and calendar updates for this event will show up here."
                  : "Try All to see the rest of this event’s history."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col">
            {groups.map((group) => (
              <section key={group.label} className="min-w-0">
                <h3 className="sticky top-0 z-[1] bg-card pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h3>
                {group.items.map((item) => (
                  <ActivityRow key={item.id} item={item} now={now} />
                ))}
              </section>
            ))}
          </div>
        )}
        {showRawSource && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Raw ICS data</summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3">
              {JSON.stringify({
                rawSummary: event.rawSummary,
                rawLocationText: event.rawLocationText,
                rawDescription: event.rawDescription,
              }, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
