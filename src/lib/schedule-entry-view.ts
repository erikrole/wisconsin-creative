import { userHasShift, type CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { calendarDate } from "@/lib/format";
import { sortCalendarEventsForDisplay } from "@/lib/calendar-event-dates";
import { venueToneFromEvent } from "@/lib/venue-tone";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";
import { filterEntriesForScheduleQueue, type ScheduleQueue } from "@/lib/schedule-queues";
import type { HomeAwayFilter } from "@/lib/schedule-url-state";

export type ScheduleEntryFilters = {
  myShiftsOnly: boolean;
  currentUserId: string;
  homeAwayFilter: HomeAwayFilter;
  areaFilter: string;
  coverageFilter: string;
  queue: ScheduleQueue | null;
  health: ScheduleHealthSnapshot | null;
  staleSourceIds: Set<string>;
};

/** The filters the server cannot apply, in display order. */
export function filterScheduleEntries(entries: CalendarEntry[], filters: ScheduleEntryFilters): CalendarEntry[] {
  let result = entries;
  if (filters.myShiftsOnly && filters.currentUserId) {
    result = result.filter((e) => userHasShift(e, filters.currentUserId));
  }
  if (filters.homeAwayFilter !== "all") {
    result = result.filter((e) => venueToneFromEvent(e) === filters.homeAwayFilter);
  }
  if (filters.areaFilter) {
    result = result.filter((e) => e.shifts.some((s) => s.area === filters.areaFilter));
  }
  if (filters.coverageFilter === "unfilled") {
    result = result.filter((e) => !e.coverage || e.coverage.percentage < 100);
  } else if (filters.coverageFilter === "filled") {
    result = result.filter((e) => e.coverage && e.coverage.percentage >= 100);
  }
  result = filterEntriesForScheduleQueue({
    entries: result,
    queue: filters.queue,
    health: filters.health,
    currentUserId: filters.currentUserId,
    staleSourceIds: filters.staleSourceIds,
  });
  return sortCalendarEventsForDisplay(result);
}

/**
 * Group sorted entries into day sections for the list.
 *
 * The timeline scrolls to today on open, so today has to exist as a row even
 * when nothing is scheduled -- otherwise a quiet day has no anchor and the list
 * opens wherever the nearest event happens to be.
 *
 * A deep link to an explicit date range is the exception: that reader asked
 * for a window, and dropping today into it would both invent a row outside the
 * range and drag the view away from what they followed the link to see.
 */
export function groupScheduleEntriesByDay(
  entries: CalendarEntry[],
  { isTimeline, now = new Date() }: { isTimeline: boolean; now?: Date },
): [string, CalendarEntry[]][] {
  const groups: [string, CalendarEntry[]][] = [];
  let lastKey = "";
  for (const entry of entries) {
    const key = calendarDate(entry.startsAt, entry.allDay).toDateString();
    if (key !== lastKey) {
      groups.push([key, []]);
      lastKey = key;
    }
    groups[groups.length - 1]![1]!.push(entry); // at least one group pushed above in this iteration
  }

  if (isTimeline) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toDateString();
    if (!groups.some(([key]) => key === todayKey)) {
      const index = groups.findIndex(([key]) => new Date(key).getTime() > today.getTime());
      groups.splice(index === -1 ? groups.length : index, 0, [todayKey, []]);
    }
  }

  return groups;
}
