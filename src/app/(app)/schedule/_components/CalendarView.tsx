import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import EmptyState from "@/components/EmptyState";
import { formatTimeShort } from "@/lib/format";
import { eventOccursOnCalendarDay, formatCalendarEventAllDayLabel } from "@/lib/calendar-event-dates";
import { cn } from "@/lib/utils";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import type { CalendarEntry } from "./types";
import { ACTIVE_STATUSES, AREA_LABELS, scheduleEventTitleParts } from "./types";
import { CoverageTag } from "./Coverage";

type CalendarViewProps = {
  entries: CalendarEntry[];
  calMonth: Date;
  setCalMonth: (d: Date) => void;
  expandedDay: number | null;
  setExpandedDay: (d: number | null) => void;
  onSelectGroup: (groupId: string | null) => void;
  onSwitchToList?: () => void;
};

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
  onSelectGroup,
}: {
  entry: CalendarEntry;
  onSelectGroup: (groupId: string | null) => void;
}) {
  const titleParts = scheduleEventTitleParts(entry);
  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];

  const chipClass = cn(
    "mb-px flex w-full cursor-pointer items-stretch overflow-hidden rounded-sm text-left outline-none transition-[background-color,scale] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring",
  );

  const inner = (
    <>
      <div className={cn("w-[2.5px] flex-shrink-0", venueTone.solidClass)} />
      <div className={cn("flex-1 px-1 py-[2px] min-w-0", venueTone.surfaceClass)}>
        <div className="flex items-center gap-1 min-w-0">
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium leading-[1.35]">
            {titleParts.title}
          </span>
          {entry.coverage && (
            <CoverageTag
              percentage={entry.coverage.percentage}
              filled={entry.coverage.filled}
              total={entry.coverage.total}
            />
          )}
        </div>
      </div>
    </>
  );

  if (entry.shiftGroupId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={chipClass}
            onClick={() => onSelectGroup(entry.shiftGroupId)}
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

/* ── Main CalendarView ── */

export function CalendarView({
  entries,
  calMonth,
  onSwitchToList,
  setCalMonth,
  expandedDay,
  setExpandedDay,
  onSelectGroup,
}: CalendarViewProps) {
  const calCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
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

  function prevMonth() {
    setCalMonth(
      new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1),
    );
  }
  function nextMonth() {
    setCalMonth(
      new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1),
    );
  }
  function goCalToday() {
    const d = new Date();
    setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  return (
    <div className="mb-1">
      {/* ── Calendar Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={prevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={nextMonth}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          <h2
            className="text-xl! font-bold! tracking-tight uppercase"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {calMonth.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
        </div>
        <Button variant="outline" className="h-10" onClick={goCalToday}>
          Today
        </Button>
      </div>

      {/* ── Mobile notice ── */}
      <div className="hidden max-md:flex flex-col items-center gap-3 py-8 px-4 text-muted-foreground text-sm border border-border/60 rounded-lg bg-muted/20 text-center">
        <span>Calendar view is best on desktop.</span>
        {onSwitchToList && (
          <Button variant="outline" size="sm" className="h-10" onClick={onSwitchToList}>
            Switch to List view
          </Button>
        )}
      </div>

      {/* ── Calendar Grid ── */}
      {entries.length === 0 ? (
        <div className="hidden rounded-lg border border-border/60 bg-card md:block">
          <EmptyState
            icon="calendar"
            title="No events this month"
            description="Try another month or clear schedule filters."
            compact
          />
        </div>
      ) : (
      <div className="hidden md:block border border-border/60 rounded-lg overflow-hidden">
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
                  "min-h-[88px] p-1 overflow-hidden border-t border-border/40",
                  i % 7 !== 0 && "border-l border-l-border/40",
                  cell.day === null ? "bg-muted/15" : "bg-card",
                  today && "bg-[var(--wi-red)]/[0.04] dark:bg-[var(--wi-red)]/[0.08]",
                  isExpanded && "z-10 relative shadow-lg",
                )}
              >
                {cell.day && (
                  <>
                    {/* Date numeral */}
                    <div className="flex justify-center mb-1">
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
                    </div>

                    {/* Events */}
                    {visibleEntries?.map((entry) => (
                      <EventChip
                        key={`${entry.id}-${cell.day}`}
                        entry={entry}
                        onSelectGroup={onSelectGroup}
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
      )}
    </div>
  );
}
