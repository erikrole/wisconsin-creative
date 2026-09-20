"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import { SCHEDULE_ACTIVITY_FEED_LIMIT } from "@/lib/schedule-recent-activity";
import type { CombinedScheduleEventSuggestion } from "@/lib/combined-schedule-event-suggestions";
import type { DescribedScheduleChange } from "@/app/(app)/events/[id]/_activity";
import { cn } from "@/lib/utils";
import { ScheduleSyncDiff } from "./ScheduleSyncDiff";
import type { CalendarEntry } from "./types";
import { scheduleEventTitleParts } from "./types";

type Panel = "crew" | "combine" | "updates" | null;

const INDICATOR_CLASS = cn(
  "inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium",
  "border border-transparent transition-[background-color,border-color,color,scale]",
  "hover:bg-muted/55 active:scale-[0.96]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "aria-expanded:border-border/60 aria-expanded:bg-muted/40",
);

function eventTitle(entry: CalendarEntry | undefined) {
  if (!entry) return "Schedule event";
  return scheduleEventTitleParts(entry).title;
}

function syncHeadline(item: DescribedScheduleChange) {
  if (item.kind === "event_created") return item.headline;
  return item.supporting && item.supporting !== "The specific fields were not recorded."
    ? item.supporting
    : item.headline;
}

function Indicator({
  active,
  ariaControls,
  ariaLabel,
  children,
  className,
  onClick,
  tone,
  tooltip,
}: {
  active?: boolean;
  ariaControls?: string;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
  onClick: () => void;
  tone: "critical" | "attention" | "info";
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={active}
          aria-controls={ariaControls}
          onClick={onClick}
          className={cn(
            INDICATOR_CLASS,
            tone === "critical" && "text-[var(--red-text)]",
            tone === "attention" && "text-[var(--orange-text)]",
            tone === "info" && "text-[var(--blue-text)]",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
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
  const [panel, setPanel] = useState<Panel>(null);
  const now = new Date();
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleReleases = isStaff ? releaseFailures : [];
  const visibleChanges = changes.slice(0, SCHEDULE_ACTIVITY_FEED_LIMIT);
  const canSeeAll = Boolean(onSeeAll) && changes.length > 0;
  const hasIndicators =
    visibleReleases.length > 0 || Boolean(combineSuggestion) || visibleChanges.length > 0;

  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));

  if (!hasIndicators) {
    return (
      <p className="flex h-10 items-center px-1 text-xs text-muted-foreground">
        {isStaff ? "No recent schedule updates" : "No recent activity"}
      </p>
    );
  }

  const releaseEntry = visibleReleases[0];

  return (
    <div className="min-w-0">
      <div className="flex h-10 items-center gap-0.5">
        {visibleReleases.length > 0 ? (
          <Indicator
            active={panel === "crew"}
            ariaControls="schedule-activity-crew"
            ariaLabel={`Crew not released, ${releaseFailures.length}`}
            onClick={() => toggle("crew")}
            tone="critical"
            tooltip="Crew not released"
          >
            <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{releaseFailures.length}</span>
          </Indicator>
        ) : null}

        {combineSuggestion ? (
          <Indicator
            active={panel === "combine"}
            ariaControls="schedule-activity-combine"
            ariaLabel={`May share a crew · ${combineSuggestion.sportFamily}`}
            onClick={() => toggle("combine")}
            tone="attention"
            tooltip={`May share a crew · ${combineSuggestion.sportFamily}`}
          >
            <SparklesIcon className="size-3.5 shrink-0" aria-hidden="true" />
          </Indicator>
        ) : null}

        {visibleChanges.length > 0 ? (
          <Indicator
            active={panel === "updates"}
            ariaControls="schedule-sync-activity"
            ariaLabel={`Schedule updates, ${visibleChanges.length}`}
            onClick={() => toggle("updates")}
            tone="info"
            tooltip="Schedule updates"
          >
            <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{visibleChanges.length}</span>
          </Indicator>
        ) : null}
      </div>

      {panel === "crew" && releaseEntry ? (
        <div id="schedule-activity-crew" className="pb-1">
          <div className="flex min-h-10 items-center gap-2 rounded-md px-2">
            <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-destructive">
                Crew not released · {eventTitle(releaseEntry)}
              </p>
              {releaseEntry.autoReleaseError ? (
                <p className="truncate text-[11px] text-muted-foreground">{releaseEntry.autoReleaseError}</p>
              ) : null}
            </div>
            {onReviewPendingCrew ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0"
                onClick={() => onReviewPendingCrew(releaseEntry)}
              >
                Review
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {panel === "combine" && combineSuggestion ? (
        <div id="schedule-activity-combine" className="pb-1">
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
        </div>
      ) : null}

      {panel === "updates" && visibleChanges.length > 0 ? (
        <ul id="schedule-sync-activity" className="flex flex-col pb-1">
          {visibleChanges.map((item) => {
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
                  <CalendarClockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-medium">
                      <ScheduleSyncDiff text={syncHeadline(item)} />
                      {item.repeatCount && item.repeatCount > 1 ? (
                        <span className="text-muted-foreground">×{item.repeatCount}</span>
                      ) : null}
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
      ) : null}
    </div>
  );
}
