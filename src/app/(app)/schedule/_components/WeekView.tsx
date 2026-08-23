"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArchiveIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import { eventOccursOnCalendarDay, formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import {
  type CalendarEntry,
  getMonday,
  scheduleEventTitleParts,
  userHasShift,
  formatTime,
} from "./types";
import { CoverageMeter } from "./Coverage";

type WeekViewProps = {
  entries: CalendarEntry[];
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  loading: boolean;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onSelectGroup: (groupId: string | null) => void;
};

function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function weekRangeLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);
  const startStr = weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endStr = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} - ${endStr}`;
}

function shiftWeek(weekStart: Date, delta: number): Date {
  const d = new Date(weekStart);
  d.setDate(weekStart.getDate() + 7 * delta);
  return d;
}

/* ── Event Card (week grid cell) ── */

function EventCard({
  entry,
  currentUserId,
  currentUserRole,
  myShiftsOnly,
  onSelectGroup,
}: {
  entry: CalendarEntry;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onSelectGroup: (groupId: string | null) => void;
}) {
  const isStaff = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const hasShift = userHasShift(entry, currentUserId);
  const titleParts = scheduleEventTitleParts(entry);
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
  const canOpenPanel = entry.shiftGroupId && isStaff;

  const wrapClass = cn(
    "mb-1.5 flex w-full items-stretch overflow-hidden rounded-sm text-left outline-none transition-[background-color,opacity,scale] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring",
    venueTone.surfaceClass,
    myShiftsOnly && !hasShift && "opacity-40",
    hasShift && "ring-1 ring-[var(--blue)]/50",
  );

  const inner = (
    <>
      {/* Left color bar */}
      <div className={cn("w-[3px] flex-shrink-0", venueTone.solidClass)} />

      {/* Content */}
      <div className="flex-1 px-1.5 py-1 min-w-0">
        <span className="block text-[10px] text-muted-foreground leading-none mb-0.5">
          {entry.allDay ? formatCalendarEventAllDayLabel(entry) : formatTime(entry.startsAt)}
        </span>
        <span className="block text-[11px] font-semibold leading-tight truncate">
          {titleParts.title}
        </span>
        {titleParts.detail && (
          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
            {titleParts.detail}
          </span>
        )}
        {entry.coverage && (
          <CoverageMeter
            className="mt-1.5"
            percentage={entry.coverage.percentage}
            filled={entry.coverage.filled}
            total={entry.coverage.total}
          />
        )}
        {hasShift && (
          <span className="mt-0.5 block text-[9px] font-semibold text-[var(--blue-text)]">
            You
          </span>
        )}
        {entry.archivedAt && (
          <span className="mt-0.5 flex items-center gap-0.5 text-[9px] text-muted-foreground/50">
            <ArchiveIcon className="size-2.5" />
            Archived
          </span>
        )}
      </div>
    </>
  );

  if (canOpenPanel) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={wrapClass}
            onClick={() => onSelectGroup(entry.shiftGroupId)}
          >
            {inner}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {titleParts.title}
          {titleParts.detail && ` - ${titleParts.detail}`}
          {entry.coverage &&
            ` (${entry.coverage.filled}/${entry.coverage.total} filled)`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={`/events/${entry.id}`} className={wrapClass}>
      {inner}
    </Link>
  );
}

/* ── Loading Skeleton ── */

function WeekSkeleton() {
  return (
    <>
      {/* Desktop skeleton */}
      <div className="grid grid-cols-7 gap-px bg-border/40 rounded-lg overflow-hidden max-md:hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-card p-2 pb-1.5 min-h-[120px]">
            <Skeleton className="h-3 w-6 mx-auto mb-1" />
            <Skeleton className="h-2 w-8 mx-auto mb-3" />
            <Skeleton className="h-12 w-full mb-1.5 rounded-sm" />
            <Skeleton className="h-12 w-full mb-1.5 rounded-sm" />
          </div>
        ))}
      </div>
      {/* Mobile skeleton */}
      <div className="md:hidden border rounded-lg overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-3 py-3 border-b last:border-b-0"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-6" />
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Mobile Day Section ── */

function MobileDaySection({
  day,
  entries,
  isToday,
  defaultExpanded,
  currentUserId,
  currentUserRole,
  myShiftsOnly,
  onSelectGroup,
}: {
  day: Date;
  entries: CalendarEntry[];
  isToday: boolean;
  defaultExpanded: boolean;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onSelectGroup: (groupId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className={cn(
        "border-b last:border-b-0",
        isToday && "bg-[var(--wi-red)]/[0.04] dark:bg-[var(--wi-red)]/[0.08]",
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between px-3 py-2.5 text-left outline-none transition-[background-color,scale] hover:bg-muted/30 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <div className="flex items-center gap-2.5">
            {/* Date marker */}
            <div
              className={cn(
                "flex flex-col items-center w-8 leading-none",
                isToday ? "text-[var(--wi-red)]" : "text-foreground",
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className="text-xl font-bold leading-tight"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {day.getDate()}
              </span>
            </div>
            <div className="flex flex-col">
              <span
                className={cn(
                  "text-sm font-medium",
                  isToday && "text-[var(--wi-red)]",
                )}
              >
                {day.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              {isToday && (
                <span className="text-[10px] font-semibold text-[var(--wi-red)] uppercase tracking-wider">
                  Today
                </span>
              )}
            </div>
          </div>
          <span className="flex items-center gap-2">
            {entries.length > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground">
                {entries.length}
              </span>
            )}
            <ChevronDownIcon
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 flex flex-col gap-1">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 py-1">No events</p>
          ) : (
            entries.map((entry) => (
              <EventCard
                key={entry.id}
                entry={entry}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                myShiftsOnly={myShiftsOnly}
                onSelectGroup={onSelectGroup}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ── Main WeekView ── */

export function WeekView({
  entries,
  weekStart,
  setWeekStart,
  loading,
  currentUserId,
  currentUserRole,
  myShiftsOnly,
  onSelectGroup,
}: WeekViewProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const day of weekDays) {
      map.set(day.toDateString(), []);
    }
    for (const entry of entries) {
      for (const day of weekDays) {
        if (!eventOccursOnCalendarDay(entry, day)) continue;
        const dayEntries = map.get(day.toDateString());
        if (dayEntries) dayEntries.push(entry);
      }
    }
    for (const dayEntries of map.values()) {
      dayEntries.sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
    }
    return map;
  }, [entries, weekDays]);

  const thisMonday = getMonday(new Date());
  const isThisWeek = isSameDay(weekStart, thisMonday);

  return (
    <div>
      {/* ── Week navigation ── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
            aria-label="Previous week"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
            aria-label="Next week"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          {!isThisWeek && (
            <Button
              variant="ghost"
              className="ml-1 h-10"
              onClick={() => setWeekStart(thisMonday)}
            >
              Today
            </Button>
          )}
        </div>
        <span
          className="text-sm font-semibold text-muted-foreground tracking-tight"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {weekRangeLabel(weekStart)}
        </span>
      </div>

      {/* Loading */}
      {loading && <WeekSkeleton />}

      {/* ── Desktop: 7-column grid ── */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-7 gap-px bg-border/40 rounded-lg overflow-hidden max-md:hidden">
          {weekDays.map((day) => {
            const dayKey = day.toDateString();
            const dayEntries = entriesByDay.get(dayKey) ?? [];
            const isDayToday = isSameDay(day, today);

            return (
              <div
                key={dayKey}
                className={cn(
                  "bg-card p-2 pb-2 min-h-[120px]",
                  isDayToday && "bg-[var(--wi-red)]/[0.04] dark:bg-[var(--wi-red)]/[0.08]",
                )}
              >
                {/* Day column header */}
                <div className="flex flex-col items-center mb-2">
                  <span
                    className={cn(
                      "text-[9px] font-semibold uppercase tracking-widest leading-none mb-0.5",
                      isDayToday ? "text-[var(--wi-red)]" : "text-muted-foreground",
                    )}
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span
                    className={cn(
                      "text-lg font-bold leading-none",
                      isDayToday ? "text-[var(--wi-red)]" : "text-foreground",
                    )}
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {dayEntries.length === 0 ? (
                  <p className="text-[9px] text-muted-foreground/30 text-center py-3">
                    -
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {dayEntries.map((entry) => (
                      <EventCard
                        key={`${entry.id}-${dayKey}`}
                        entry={entry}
                        currentUserId={currentUserId}
                        currentUserRole={currentUserRole}
                        myShiftsOnly={myShiftsOnly}
                        onSelectGroup={onSelectGroup}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Mobile: collapsible day sections ── */}
      {!loading && entries.length > 0 && (
        <div className="md:hidden border border-border/60 rounded-lg overflow-hidden">
          {weekDays.map((day) => {
            const dayKey = day.toDateString();
            const dayEntries = entriesByDay.get(dayKey) ?? [];
            const isDayToday = isSameDay(day, today);

            return (
              <MobileDaySection
                key={dayKey}
                day={day}
                entries={dayEntries}
                isToday={isDayToday}
                defaultExpanded={isDayToday}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                myShiftsOnly={myShiftsOnly}
                onSelectGroup={onSelectGroup}
              />
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <EmptyState
          icon="calendar"
          title="No events this week"
          description="Try navigating to a different week or clear schedule filters."
          compact
        />
      )}
    </div>
  );
}
