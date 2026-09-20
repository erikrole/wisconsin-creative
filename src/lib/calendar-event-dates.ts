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

function localDayStartMs(date: Date): number {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
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

function formatLocalMonthDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatLocalMonthDayYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
    : Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
}

/**
 * Sort schedule rows in the order they appear to a local/Central user.
 * All-day starts are encoded date values at UTC midnight, so only their
 * encoded calendar date is used for ordering. Timed starts remain local
 * instants and are ordered by their actual start time within that day.
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

function allDayInclusiveEndDate(event: CalendarEventDateLike): Date {
  return utcDateFromMs(allDayEndExclusiveMs(event) - DAY_MS);
}

export function eventSpansMultipleDays(event: CalendarEventDateLike): boolean {
  const start = toDate(event.startsAt);
  const end = toDate(event.endsAt);
  if (event.allDay) {
    return !sameUtcDay(start, allDayInclusiveEndDate(event));
  }
  return !sameLocalDay(start, end);
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

  const end = toDate(event.endsAt);
  if (sameLocalDay(start, end)) {
    return includeYear ? formatLocalMonthDayYear(start) : formatLocalMonthDay(start);
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    const base = `${formatLocalMonthDay(start)}-${end.getDate()}`;
    return includeYear ? `${base}, ${start.getFullYear()}` : base;
  }
  if (sameYear) {
    const base = `${formatLocalMonthDay(start)}-${formatLocalMonthDay(end)}`;
    return includeYear ? `${base}, ${start.getFullYear()}` : base;
  }
  return `${formatLocalMonthDayYear(start)}-${formatLocalMonthDayYear(end)}`;
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

  const dayMs = localDayStartMs(day);
  const startMs = localDayStartMs(toDate(event.startsAt));
  const rawEnd = toDate(event.endsAt);
  const endMs = localDayStartMs(rawEnd);
  const endExclusiveMs = rawEnd.getTime() === endMs ? endMs : endMs + DAY_MS;
  return dayMs >= startMs && dayMs < endExclusiveMs;
}
