"use client";

import Link from "next/link";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  Clock3Icon,
  SparklesIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import {
  SCHEDULE_ACTIVITY_FEED_LIMIT,
  SCHEDULE_ACTIVITY_RELEASE_LIMIT,
} from "@/lib/schedule-recent-activity";
import type { CombinedScheduleEventSuggestion } from "@/lib/combined-schedule-event-suggestions";
import type { ScheduleChangeKind } from "@/lib/schedule-change-history-types";
import type { DescribedScheduleChange } from "@/app/(app)/events/[id]/_activity";
import { cn } from "@/lib/utils";
import type { CalendarEntry } from "./types";
import { scheduleEventTitleParts } from "./types";

function changeIcon(kind: ScheduleChangeKind) {
  if (kind === "event_created" || kind === "event_updated" || kind === "event_visibility_updated") {
    return CalendarClockIcon;
  }
  if (kind === "assignment_assigned" || kind === "pickup_claimed") return UserPlusIcon;
  if (kind === "assignment_removed" || kind === "pickup_requested") return UserRoundIcon;
  if (kind === "published" || kind === "republished") return UsersIcon;
  return Clock3Icon;
}

function eventTitle(entry: CalendarEntry | undefined) {
  if (!entry) return "Schedule event";
  return scheduleEventTitleParts(entry).title;
}

export function ScheduleRecentActivity({
  changes,
  combineSuggestion,
  entries,
  isStaff,
  onDismissCombine,
  onReviewCombine,
  onReviewPendingCrew,
  onSeeAll,
  releaseFailures,
}: {
  changes: DescribedScheduleChange[];
  combineSuggestion: CombinedScheduleEventSuggestion<CalendarEntry> | null;
  entries: CalendarEntry[];
  isStaff: boolean;
  onDismissCombine?: (suggestion: CombinedScheduleEventSuggestion<CalendarEntry>) => void;
  onReviewCombine?: (suggestion: CombinedScheduleEventSuggestion<CalendarEntry>) => void;
  onReviewPendingCrew?: (entry: CalendarEntry) => void;
  onSeeAll?: () => void;
  releaseFailures: CalendarEntry[];
}) {
  const now = new Date();
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleReleases = isStaff ? releaseFailures.slice(0, SCHEDULE_ACTIVITY_RELEASE_LIMIT) : [];
  const remainingAfterUrgent = Math.max(
    0,
    SCHEDULE_ACTIVITY_FEED_LIMIT - visibleReleases.length - (combineSuggestion ? 1 : 0),
  );
  const visibleChanges = changes.slice(0, remainingAfterUrgent);
  const extraReleases = Math.max(0, releaseFailures.length - visibleReleases.length);
  const hasRows = visibleReleases.length > 0 || Boolean(combineSuggestion) || visibleChanges.length > 0;
  const canSeeAll = Boolean(onSeeAll) && changes.length > 0;

  return (
    <div className="min-w-0">
      <div className="flex h-10 items-center px-2">
        <p className="truncate text-xs font-medium text-muted-foreground">Recent activity</p>
      </div>

      {hasRows ? (
        <ul className="flex flex-col">
          {visibleReleases.map((entry) => (
            <li key={`release:${entry.id}`}>
              <div className="flex min-h-10 items-center gap-2 rounded-md px-2">
                <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-destructive">
                    Crew not released · {eventTitle(entry)}
                  </p>
                  {entry.autoReleaseError ? (
                    <p className="truncate text-[11px] text-muted-foreground">{entry.autoReleaseError}</p>
                  ) : null}
                </div>
                {onReviewPendingCrew ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0"
                    onClick={() => onReviewPendingCrew(entry)}
                  >
                    Review
                  </Button>
                ) : null}
              </div>
            </li>
          ))}

          {combineSuggestion ? (
            <li>
              <div className="flex min-h-10 items-center gap-2 rounded-md px-2">
                <SparklesIcon className="size-3.5 shrink-0 text-[var(--orange-text)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    May share a crew · {combineSuggestion.sportFamily}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {combineSuggestion.first.summary} + {combineSuggestion.second.summary}
                  </p>
                </div>
                {onReviewCombine ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0"
                    onClick={() => onReviewCombine(combineSuggestion)}
                  >
                    Review
                  </Button>
                ) : null}
                {onDismissCombine ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0 text-muted-foreground"
                    aria-label={`Dismiss ${combineSuggestion.sportFamily} suggestion`}
                    onClick={() => onDismissCombine(combineSuggestion)}
                  >
                    <XIcon className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ) : null}

          {visibleChanges.map((item) => {
            const Icon = changeIcon(item.kind);
            const title = eventTitle(entryById.get(item.eventId));
            return (
              <li key={`${item.id}:${item.eventId}`}>
                <Link
                  href={`/events/${item.eventId}`}
                  className={cn(
                    "flex min-h-10 items-center gap-2 rounded-md px-2 text-inherit no-underline",
                    "transition-[background-color,scale] hover:bg-muted/55 active:scale-[0.99]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {item.headline}
                      {item.repeatCount && item.repeatCount > 1 ? ` · ×${item.repeatCount}` : ""}
                      {item.draft ? " · Draft" : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{title}</p>
                  </div>
                  <time
                    className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                    dateTime={item.createdAt}
                    title={new Date(item.createdAt).toLocaleString()}
                  >
                    {formatRelativeTime(item.createdAt, now)}
                  </time>
                </Link>
              </li>
            );
          })}

          {canSeeAll ? (
            <li>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 w-full justify-start px-2 text-xs font-semibold text-muted-foreground"
                onClick={onSeeAll}
              >
                See all activity
              </Button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="flex h-10 items-center px-2 text-xs text-muted-foreground">
          {isStaff
            ? "No recent crew or calendar changes"
            : "No recent activity"}
        </p>
      )}

      {extraReleases > 0 ? (
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          {extraReleases} more unreleased crew{extraReleases === 1 ? "" : "s"} stay on their events.
        </p>
      ) : null}
    </div>
  );
}
