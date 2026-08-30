import { useMemo } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import EmptyState from "@/components/EmptyState";
import { formatTimeShort } from "@/lib/format";
import { eventOccursOnCalendarDay, formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { cn } from "@/lib/utils";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import type { CalendarEntry } from "./types";
import { ACTIVE_STATUSES, AREA_LABELS, scheduleEventTitleParts } from "./types";
import { CoverageTag } from "./Coverage";
import { SchedulePeriodNavigator } from "./SchedulePeriodNavigator";

type CalendarViewProps = {
  entries: CalendarEntry[];
  loading: boolean;
  calMonth: Date;
  setCalMonth: (d: Date) => void;
  expandedDay: number | null;
  setExpandedDay: (d: number | null) => void;
  canManageCrew: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
};

function CalendarSkeleton() {
  return (
    <div role="status" aria-label="Loading calendar" aria-busy="true">
      <div className="hidden overflow-hidden rounded-lg border border-border/60 md:block">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/25">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex justify-center py-2">
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }, (_, index) => (
            <div
              key={index}
              className={cn(
                "min-h-[112px] border-t border-border/40 p-2",
                index % 7 !== 0 && "border-l border-l-border/40",
              )}
            >
              <Skeleton className="mb-3 size-6 rounded-full" />
              {index % 3 === 0 && <Skeleton className="h-8 w-full rounded-sm" />}
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="border-b border-border/50 p-3 last:border-b-0">
            <Skeleton className="mb-3 h-4 w-24" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

function isToday(calMonth: Date, day: number) {
  const now = new Date();
  return (
    calMonth.getFullYear() === now.getFullYear() &&
    calMonth.getMonth() === now.getMonth() &&
    day === now.getDate()
  );
}

function buildTooltipContent(entry: CalendarEntry): React.ReactNode {
  const timeStr = entry.allDay
    ? formatCalendarEventAllDayLabel(entry)
    : `${formatTimeShort(entry.startsAt)} - ${formatTimeShort(entry.endsAt)}`;

  const assignedUsers = entry.shifts.flatMap((s) =>
    s.assignments
      .filter((a) => ACTIVE_STATUSES.includes(a.status))
      .map((a) => ({ name: a.user.name, area: AREA_LABELS[s.area] ?? s.area })),
  );
  const titleParts = scheduleEventTitleParts(entry);

  return (
    <div className="text-xs flex flex-col gap-1 max-w-[220px]">
      <div className="font-semibold text-sm">{titleParts.title}</div>
      {titleParts.detail && (
        <div className="text-muted-foreground">{titleParts.detail}</div>
      )}
      <div className="text-muted-foreground">{timeStr}</div>
      {assignedUsers.length > 0 && (
        <div className="text-muted-foreground">
          {assignedUsers.map((u, i) => (
            <span key={i}>
              {i > 0 && ", "}
              {u.name} ({u.area})
            </span>
          ))}
        </div>
      )}
      {entry.coverage && (
        <div className="text-muted-foreground">
          {entry.coverage.filled}/{entry.coverage.total} filled
        </div>
      )}
    </div>
  );
}

/* ── Event chip inside a calendar cell ── */

function EventChip({
  entry,
  canManageCrew,
  onOpenCrew,
}: {
  entry: CalendarEntry;
  canManageCrew: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
}) {
  const titleParts = scheduleEventTitleParts(entry);
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];

  const chipClass = cn(
    "mb-1 flex min-h-10 w-full cursor-pointer items-stretch overflow-hidden rounded-sm border border-border/30 text-left outline-none transition-[background-color,border-color,scale] hover:border-border/70 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
  );

  const inner = (
    <>
      <div className={cn("w-[2.5px] flex-shrink-0", venueTone.solidClass)} />
      <div className={cn("min-w-0 flex-1 px-1.5 py-1", venueTone.surfaceClass)}>
        <div className="mb-0.5 flex items-center justify-between gap-1 text-[9px] text-muted-foreground">
          <span className="truncate">{entry.allDay ? "All day" : formatTimeShort(entry.startsAt)}</span>
          {entry.coverage ? (
            <CoverageTag
              percentage={entry.coverage.percentage}
              filled={entry.coverage.filled}
              total={entry.coverage.total}
            />
          ) : canManageCrew ? (
            <span className="shrink-0 font-medium">Set up</span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-start gap-1">
          <span className="line-clamp-2 min-w-0 flex-1 text-[10px] font-medium leading-[1.3]">
            {titleParts.title}
          </span>
        </div>
      </div>
    </>
  );

  if (canManageCrew) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={chipClass}
            aria-label={`${entry.shiftGroupId ? "Manage crew for" : "Set up crew for"} ${titleParts.title}`}
            onClick={() => onOpenCrew(entry)}
          >
            {inner}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {buildTooltipContent(entry)}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/events/${entry.id}`} className={chipClass}>
          {inner}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        {buildTooltipContent(entry)}
      </TooltipContent>
    </Tooltip>
  );
}

function MobileCalendarEvent({
  entry,
  canManageCrew,
  onOpenCrew,
}: {
  entry: CalendarEntry;
  canManageCrew: boolean;
  onOpenCrew: (entry: CalendarEntry) => void;
}) {
  const titleParts = scheduleEventTitleParts(entry);
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
  const openSlots = entry.coverage
    ? Math.max(0, entry.coverage.total - entry.coverage.filled)
    : 0;
  const className = cn(
    "flex min-h-16 w-full items-stretch overflow-hidden rounded-md border border-border/40 text-left outline-none transition-[border-color,scale] hover:border-border/80 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring",
  );
  const content = (
    <>
      <span className={cn("w-[3px] shrink-0", venueTone.solidClass)} />
      <span className={cn("min-w-0 flex-1 px-3 py-2.5", venueTone.surfaceClass)}>
        <span className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{entry.allDay ? formatCalendarEventAllDayLabel(entry) : formatTimeShort(entry.startsAt)}</span>
          <span>{venueTone.label}</span>
        </span>
        <span className="block text-sm font-semibold leading-snug text-foreground">
          {titleParts.title}
        </span>
        {titleParts.detail && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{titleParts.detail}</span>
        )}
        {entry.coverage && (
          <span className="mt-2 flex items-center justify-between gap-2">
            <CoverageTag
              percentage={entry.coverage.percentage}
              filled={entry.coverage.filled}
              total={entry.coverage.total}
            />
            {openSlots > 0 && <span className="text-[10px] text-muted-foreground">{openSlots} open</span>}
          </span>
        )}
        {!entry.coverage && canManageCrew && (
          <span className="mt-2 block text-[10px] font-medium text-muted-foreground">Set up crew</span>
        )}
      </span>
    </>
  );

  return canManageCrew ? (
    <button
      className={className}
      aria-label={`${entry.shiftGroupId ? "Manage crew for" : "Set up crew for"} ${titleParts.title}`}
      onClick={() => onOpenCrew(entry)}
    >
      {content}
    </button>
  ) : (
    <Link href={`/events/${entry.id}`} className={className}>
      {content}
    </Link>
  );
}

/* ── Main CalendarView ── */

export function CalendarView({
  entries,
  loading,
  calMonth,
  setCalMonth,
  expandedDay,
  setExpandedDay,
  canManageCrew,
  onOpenCrew,
}: CalendarViewProps) {
  const calCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
    // Pad out the last week. Without this the month ends mid-row and the grid
    // finishes on a torn edge: no cell background, no borders, just a gap where
    // the remaining weekdays should be.
    while (cells.length % 7 !== 0) cells.push({ day: null });
    return cells;
  }, [calMonth]);

  const calEntriesByDay = useMemo(() => {
    const map = new Map<number, CalendarEntry[]>();
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (const entry of entries) {
      for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        if (!eventOccursOnCalendarDay(entry, cellDate)) continue;
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push(entry);
      }
    }
    for (const dayEntries of map.values()) {
      dayEntries.sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
    }
    return map;
  }, [calMonth, entries]);

  // The expanded cell is tracked by day-of-month, which does not survive a
  // month change: paging away from an expanded 15th left the 15th of the next
  // month blown open and offering "show less" on a day with nothing to hide.
  function goToMonth(next: Date) {
    setExpandedDay(null);
    setCalMonth(next);
  }
  function prevMonth() {
    goToMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1));
  }
  function nextMonth() {
    goToMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1));
  }
  function goCalToday() {
    const d = new Date();
    goToMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  const currentMonth = isToday(calMonth, new Date().getDate());
  const activeDayCount = calEntriesByDay.size;
  const openSlotCount = entries.reduce((total, entry) => (
    total + (entry.coverage ? Math.max(0, entry.coverage.total - entry.coverage.filled) : 0)
  ), 0);
  const monthSummary = [
    `${entries.length} event${entries.length === 1 ? "" : "s"}`,
    `${activeDayCount} active day${activeDayCount === 1 ? "" : "s"}`,
    openSlotCount > 0 ? `${openSlotCount} open` : "Crew covered",
  ].join(" · ");

  return (
    <div className="mb-1" data-schedule-view="calendar">
      {/* ── Calendar Header ── */}
      <SchedulePeriodNavigator
        title={calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        summary={monthSummary}
        isCurrent={currentMonth}
        onPrevious={prevMonth}
        onNext={nextMonth}
        onToday={goCalToday}
        previousLabel="Previous month"
        nextLabel="Next month"
      />

      {/* ── Calendar Grid ── */}
      {loading ? (
        <CalendarSkeleton />
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card">
          <EmptyState
            icon="calendar"
            title="No events this month"
            description="Try another month or clear schedule filters."
            compact
          />
        </div>
      ) : (
      <>
      <div className="hidden overflow-hidden rounded-lg border border-border/60 md:block">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/25">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-widest"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calCells.map((cell, i) => {
            const dayEntries = cell.day
              ? calEntriesByDay.get(cell.day)
              : undefined;
            const isExpanded = expandedDay === cell.day;
            const visibleEntries = isExpanded
              ? dayEntries
              : dayEntries?.slice(0, 3);
            const hiddenCount = (dayEntries?.length ?? 0) - 3;
            const today = cell.day ? isToday(calMonth, cell.day) : false;

            return (
              <div
                key={i}
                className={cn(
                  "min-h-[112px] overflow-hidden border-t border-border/40 p-1.5",
                  i % 7 !== 0 && "border-l border-l-border/40",
                  cell.day === null ? "bg-muted/15" : "bg-card",
                  today && "bg-[var(--wi-red)]/[0.04] dark:bg-[var(--wi-red)]/[0.08]",
                  isExpanded && "z-10 relative shadow-lg",
                )}
              >
                {cell.day && (
                  <>
                    {/* Date numeral */}
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex size-[26px] items-center justify-center rounded-full text-sm font-bold leading-none",
                          today
                            ? "bg-[var(--wi-red)] text-white"
                            : "text-foreground",
                        )}
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {cell.day}
                      </span>
                      {(dayEntries?.length ?? 0) > 0 && (
                        <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
                          {dayEntries?.length} event{dayEntries?.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>

                    {/* Events */}
                    {visibleEntries?.map((entry) => (
                      <EventChip
                        key={`${entry.id}-${cell.day}`}
                        entry={entry}
                        canManageCrew={canManageCrew}
                        onOpenCrew={onOpenCrew}
                      />
                    ))}

                    {/* Show more / less */}
                    {!isExpanded && hiddenCount > 0 && (
                      <button
                        type="button"
                        className="flex min-h-10 w-full items-center rounded-sm px-1 text-left text-[9px] font-medium text-muted-foreground outline-none transition-[color,scale] hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setExpandedDay(cell.day)}
                      >
                        +{hiddenCount} more
                      </button>
                    )}
                    {isExpanded && hiddenCount > 0 && (
                      <button
                        type="button"
                        className="flex min-h-10 w-full items-center rounded-sm px-1 text-left text-[9px] font-medium text-muted-foreground outline-none transition-[color,scale] hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setExpandedDay(null)}
                      >
                        show less
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60 md:hidden">
        {[...calEntriesByDay.entries()].map(([day, dayEntries]) => {
          const date = new Date(calMonth.getFullYear(), calMonth.getMonth(), day);
          const today = isToday(calMonth, day);
          return (
            <section key={day} className="border-b border-border/50 last:border-b-0">
              <div className={cn(
                "flex items-center justify-between gap-3 bg-muted/15 px-3 py-2",
                today && "bg-[var(--wi-red)]/[0.05] dark:bg-[var(--wi-red)]/[0.09]",
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs font-semibold uppercase tracking-wide",
                    today ? "text-[var(--wi-red)]" : "text-foreground",
                  )}>
                    {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  {today && <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wi-red)]">Today</span>}
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {dayEntries.length} event{dayEntries.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {dayEntries.map((entry) => (
                  <MobileCalendarEvent
                    key={`${entry.id}-${day}`}
                    entry={entry}
                    canManageCrew={canManageCrew}
                    onOpenCrew={onOpenCrew}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
