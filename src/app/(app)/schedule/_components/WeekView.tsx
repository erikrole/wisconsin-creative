"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArchiveIcon, ChevronDownIcon, UsersRoundIcon } from "lucide-react";
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
import { SchedulePeriodNavigator } from "./SchedulePeriodNavigator";

type WeekViewProps = {
  entries: CalendarEntry[];
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  loading: boolean;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
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
    // A week straddling New Year reads "Dec 29 - Jan 4, 2027" without this,
    // which dates the wrong half of the range.
    ...(weekStart.getFullYear() !== end.getFullYear() ? { year: "numeric" as const } : {}),
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
  onOpenCrew,
}: {
  entry: CalendarEntry;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
}) {
  const isStaff = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const hasShift = userHasShift(entry, currentUserId);
  const titleParts = scheduleEventTitleParts(entry);
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
  const canManageCrew = isStaff;
  const openSlots = entry.coverage
    ? Math.max(0, entry.coverage.total - entry.coverage.filled)
    : 0;

  const wrapClass = cn(
    "mb-2 flex min-h-[86px] w-full items-stretch overflow-hidden rounded-md border border-border/40 text-left outline-none transition-[background-color,border-color,opacity,scale] hover:border-border/80 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
    venueTone.surfaceClass,
    myShiftsOnly && !hasShift && "opacity-40",
    hasShift && "ring-1 ring-[var(--blue)]/50",
  );

  const inner = (
    <>
      {/* Left color bar */}
      <div className={cn("w-[3px] flex-shrink-0", venueTone.solidClass)} />

      {/* Content */}
      <div className="min-w-0 flex-1 px-2 py-2">
        <div className="mb-1 flex items-center justify-between gap-1.5 text-[10px] leading-none text-muted-foreground">
          <span className="truncate">
            {entry.allDay ? formatCalendarEventAllDayLabel(entry) : formatTime(entry.startsAt)}
          </span>
          <span className="shrink-0">{venueTone.label}</span>
        </div>
        <span className="line-clamp-2 block text-xs font-semibold leading-snug text-foreground">
          {titleParts.title}
        </span>
        {titleParts.detail && (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {titleParts.detail}
          </span>
        )}
        {entry.coverage && (
          <CoverageMeter
            className="mt-2"
            percentage={entry.coverage.percentage}
            filled={entry.coverage.filled}
            total={entry.coverage.total}
          />
        )}
        {(hasShift || openSlots > 0) && (
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
            {hasShift ? (
              <span className="font-semibold text-[var(--blue-text)]">Your shift</span>
            ) : <span />}
            {openSlots > 0 && (
              <span className="text-muted-foreground">{openSlots} open</span>
            )}
          </div>
        )}
        {entry.eventArchivedAt && (
          <span className="mt-0.5 flex items-center gap-0.5 text-[9px] text-muted-foreground/50">
            <ArchiveIcon className="size-2.5" />
            Older record
          </span>
        )}
        {isStaff && (
          <span className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <UsersRoundIcon className="size-3" />
            {entry.shiftGroupId ? "Manage crew" : "Set up crew"}
          </span>
        )}
      </div>
    </>
  );

  if (canManageCrew) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={wrapClass}
            aria-label={`${entry.shiftGroupId ? "Manage crew for" : "Set up crew for"} ${titleParts.title}`}
            onClick={() => onOpenCrew(entry)}
          >
            {inner}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {entry.shiftGroupId ? "Manage crew" : "Set up crew"}: {titleParts.title}
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
  onOpenCrew,
}: {
  day: Date;
  entries: CalendarEntry[];
  isToday: boolean;
  defaultExpanded: boolean;
  currentUserId: string;
  currentUserRole: string;
  myShiftsOnly: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
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
                onOpenCrew={onOpenCrew}
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
  onOpenCrew,
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
  const activeDayCount = [...entriesByDay.values()].filter((dayEntries) => dayEntries.length > 0).length;
  const openSlotCount = entries.reduce((total, entry) => (
    total + (entry.coverage ? Math.max(0, entry.coverage.total - entry.coverage.filled) : 0)
  ), 0);
  const weekSummary = [
    `${entries.length} event${entries.length === 1 ? "" : "s"}`,
    `${activeDayCount} active day${activeDayCount === 1 ? "" : "s"}`,
    openSlotCount > 0 ? `${openSlotCount} open` : "Crew covered",
  ].join(" · ");

  return (
    <div data-schedule-view="week">
      {/* ── Week navigation ── */}
      <SchedulePeriodNavigator
        title={weekRangeLabel(weekStart)}
        summary={weekSummary}
        isCurrent={isThisWeek}
        onPrevious={() => setWeekStart(shiftWeek(weekStart, -1))}
        onNext={() => setWeekStart(shiftWeek(weekStart, 1))}
        onToday={() => setWeekStart(thisMonday)}
        previousLabel="Previous week"
        nextLabel="Next week"
      />

      {/* Loading */}
      {loading && <WeekSkeleton />}

      {/* ── Desktop: 7-column grid ── */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/40 max-md:hidden">
          {weekDays.map((day) => {
            const dayKey = day.toDateString();
            const dayEntries = entriesByDay.get(dayKey) ?? [];
            const isDayToday = isSameDay(day, today);

            return (
              <div
                key={dayKey}
                className={cn(
                  "min-h-[164px] bg-card p-2.5",
                  isDayToday && "bg-[var(--wi-red)]/[0.04] dark:bg-[var(--wi-red)]/[0.08]",
                )}
              >
                {/* Day column header */}
                <div className="mb-2.5 flex items-start justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-widest",
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
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                    {dayEntries.length || "—"}
                  </span>
                </div>

                {dayEntries.length === 0 ? (
                  <p className="py-5 text-center text-[10px] text-muted-foreground/50">
                    No events
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
                        onOpenCrew={onOpenCrew}
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
                defaultExpanded={isDayToday || dayEntries.length > 0}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                myShiftsOnly={myShiftsOnly}
                onOpenCrew={onOpenCrew}
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
