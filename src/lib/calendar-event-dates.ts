import { INSTITUTION_TZ, institutionDayParts } from "@/lib/format";

type CalendarEventDateLike = {
  startsAt: string | Date;
  endsAt: string | Date;
  allDay?: boolean | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function utcDayStartMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Midnight (as a UTC-encoded day key) of the Central calendar day an instant falls on. */
function centralDayStartMs(date: Date): number {
  const { year, month, day } = institutionDayParts(date);
  return Date.UTC(year, month - 1, day);
}

function utcDateFromMs(ms: number): Date {
  return new Date(ms);
}

function formatUtcMonthDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatUtcMonthDayYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCentralMonthDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: INSTITUTION_TZ,
  });
}

function formatCentralMonthDayYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: INSTITUTION_TZ,
  });
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sameCentralDay(a: Date, b: Date): boolean {
  return centralDayStartMs(a) === centralDayStartMs(b);
}

function allDayStartMs(event: CalendarEventDateLike): number {
  return utcDayStartMs(toDate(event.startsAt));
}

function allDayEndExclusiveMs(event: CalendarEventDateLike): number {
  const startMs = allDayStartMs(event);
  const rawEndMs = utcDayStartMs(toDate(event.endsAt));
  return rawEndMs > startMs ? rawEndMs : startMs + DAY_MS;
}

function displayDayKey(event: CalendarEventDateLike): number {
  const start = toDate(event.startsAt);
  return event.allDay
    ? Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    : centralDayStartMs(start);
}

/**
 * Sort schedule rows in the order they appear to a Central user, whether the
 * code runs in a Madison browser or on the UTC server. All-day starts are
 * encoded date values at UTC midnight, so only their encoded calendar date is
 * used for ordering. Timed starts are instants, filed under their Central
 * calendar day and ordered by their actual start time within it.
 */
export function sortCalendarEventsForDisplay<T extends CalendarEventDateLike>(events: readonly T[]): T[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const dayDelta = displayDayKey(a.event) - displayDayKey(b.event);
      if (dayDelta !== 0) return dayDelta;

      const aAllDay = Boolean(a.event.allDay);
      const bAllDay = Boolean(b.event.allDay);
      if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;

      const startDelta = toDate(a.event.startsAt).getTime() - toDate(b.event.startsAt).getTime();
      return startDelta !== 0 ? startDelta : a.index - b.index;
    })
    .map(({ event }) => event);
}

/**
 * The last instant a timed event covers. Ending exactly at midnight means "through
 * the end of that day", so the range it spans and the days it occurs on stop there.
 */
function timedInclusiveEnd(event: CalendarEventDateLike): Date {
  const start = toDate(event.startsAt).getTime();
  return new Date(Math.max(toDate(event.endsAt).getTime() - 1, start));
}

function allDayInclusiveEndDate(event: CalendarEventDateLike): Date {
  return utcDateFromMs(allDayEndExclusiveMs(event) - DAY_MS);
}

export function eventSpansMultipleDays(event: CalendarEventDateLike): boolean {
  const start = toDate(event.startsAt);
  if (event.allDay) {
    return !sameUtcDay(start, allDayInclusiveEndDate(event));
  }
  return !sameCentralDay(start, timedInclusiveEnd(event));
}

export function formatCalendarEventDateRange(
  event: CalendarEventDateLike,
  options: { includeYear?: boolean } = {},
): string {
  const includeYear = options.includeYear ?? false;
  const start = toDate(event.startsAt);

  if (event.allDay) {
    const startDay = utcDateFromMs(allDayStartMs(event));
    const endDay = allDayInclusiveEndDate(event);
    if (sameUtcDay(startDay, endDay)) {
      return includeYear ? formatUtcMonthDayYear(startDay) : formatUtcMonthDay(startDay);
    }
    const sameYear = startDay.getUTCFullYear() === endDay.getUTCFullYear();
    const sameMonth = sameYear && startDay.getUTCMonth() === endDay.getUTCMonth();
    if (sameMonth) {
      const base = `${formatUtcMonthDay(startDay)}-${endDay.getUTCDate()}`;
      return includeYear ? `${base}, ${startDay.getUTCFullYear()}` : base;
    }
    if (sameYear) {
      const base = `${formatUtcMonthDay(startDay)}-${formatUtcMonthDay(endDay)}`;
      return includeYear ? `${base}, ${startDay.getUTCFullYear()}` : base;
    }
    return `${formatUtcMonthDayYear(startDay)}-${formatUtcMonthDayYear(endDay)}`;
  }

  const end = timedInclusiveEnd(event);
  if (sameCentralDay(start, end)) {
    return includeYear ? formatCentralMonthDayYear(start) : formatCentralMonthDay(start);
  }
  const startParts = institutionDayParts(start);
  const endParts = institutionDayParts(end);
  const sameYear = startParts.year === endParts.year;
  const sameMonth = sameYear && startParts.month === endParts.month;
  if (sameMonth) {
    const base = `${formatCentralMonthDay(start)}-${endParts.day}`;
    return includeYear ? `${base}, ${startParts.year}` : base;
  }
  if (sameYear) {
    const base = `${formatCentralMonthDay(start)}-${formatCentralMonthDay(end)}`;
    return includeYear ? `${base}, ${startParts.year}` : base;
  }
  return `${formatCentralMonthDayYear(start)}-${formatCentralMonthDayYear(end)}`;
}

export function formatCalendarEventAllDayLabel(event: CalendarEventDateLike): string {
  if (!event.allDay) return "";
  return eventSpansMultipleDays(event)
    ? `All day ${formatCalendarEventDateRange(event)}`
    : "All day";
}

export function eventOccursOnCalendarDay(event: CalendarEventDateLike, day: Date): boolean {
  if (event.allDay) {
    const dayMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
    return dayMs >= allDayStartMs(event) && dayMs < allDayEndExclusiveMs(event);
  }

  // `day` is a calendar cell (its own year/month/date); the event's instants are
  // read on the Central calendar.
  const dayMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const startMs = centralDayStartMs(toDate(event.startsAt));
  const endExclusiveMs = centralDayStartMs(timedInclusiveEnd(event)) + DAY_MS;
  return dayMs >= startMs && dayMs < endExclusiveMs;
}
