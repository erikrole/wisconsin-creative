type SportCallTimeDefaults = {
  shiftStartOffset: number;
  shiftEndOffset: number;
};

type CalendarEventTiming = {
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean | null;
};

/**
 * Resolve the default shift coverage window from one event and its Sport
 * settings. All-day events retain their date span so the schedule never turns
 * a date-only event into a fabricated clock-time call.
 */
export function sportDefaultShiftWindow(
  event: CalendarEventTiming,
  defaults: SportCallTimeDefaults,
): { startsAt: Date; endsAt: Date } {
  if (event.allDay) {
    return {
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
    };
  }

  return {
    startsAt: new Date(event.startsAt.getTime() - defaults.shiftStartOffset * 60_000),
    endsAt: new Date(event.endsAt.getTime() + defaults.shiftEndOffset * 60_000),
  };
}
