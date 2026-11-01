import { afterEach, describe, expect, it } from "vitest";
import {
  eventOccursOnCalendarDay,
  eventSpansMultipleDays,
  formatCalendarEventAllDayLabel,
  formatCalendarEventDateRange,
  sortCalendarEventsForDisplay,
} from "@/lib/calendar-event-dates";

const footballMediaDay = {
  startsAt: "2026-07-07T05:00:00.000Z",
  endsAt: "2026-07-09T05:00:00.000Z",
  allDay: true,
};

describe("calendar event date helpers", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("formats all-day exclusive-end spans as inclusive operator copy", () => {
    expect(formatCalendarEventDateRange(footballMediaDay)).toBe("Jul 7-8");
    expect(formatCalendarEventDateRange(footballMediaDay, { includeYear: true })).toBe("Jul 7-8, 2026");
    expect(formatCalendarEventAllDayLabel(footballMediaDay)).toBe("All day Jul 7-8");
  });

  it("expands an all-day event across covered calendar dates only", () => {
    expect(eventOccursOnCalendarDay(footballMediaDay, new Date(2026, 6, 7))).toBe(true);
    expect(eventOccursOnCalendarDay(footballMediaDay, new Date(2026, 6, 8))).toBe(true);
    expect(eventOccursOnCalendarDay(footballMediaDay, new Date(2026, 6, 9))).toBe(false);
  });

  it("BUG: sorts mixed all-day and timed events by their Central display day", () => {
    process.env.TZ = "America/Chicago";

    const events = [
      { id: "all-day-sep-1", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-02T00:00:00.000Z", allDay: true },
      { id: "timed-aug-31", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-01T02:00:00.000Z", allDay: false },
      { id: "timed-sep-1", startsAt: "2026-09-02T01:00:00.000Z", endsAt: "2026-09-02T03:00:00.000Z", allDay: false },
      { id: "all-day-sep-2", startsAt: "2026-09-02T00:00:00.000Z", endsAt: "2026-09-03T00:00:00.000Z", allDay: true },
      { id: "timed-sep-2", startsAt: "2026-09-02T22:00:00.000Z", endsAt: "2026-09-03T00:00:00.000Z", allDay: false },
    ];

    expect(sortCalendarEventsForDisplay(events).map((event) => event.id)).toEqual([
      "timed-aug-31",
      "all-day-sep-1",
      "timed-sep-1",
      "all-day-sep-2",
      "timed-sep-2",
    ]);
  });

  it("files a Madison evening game under one Madison day", () => {
    const game = { startsAt: "2026-11-02T23:00:00.000Z", endsAt: "2026-11-03T02:00:00.000Z", allDay: false };
    expect(eventSpansMultipleDays(game)).toBe(false);
    expect(formatCalendarEventDateRange(game)).toBe("Nov 2");
    expect(formatCalendarEventDateRange(game, { includeYear: true })).toBe("Nov 2, 2026");
    expect(eventOccursOnCalendarDay(game, new Date(2026, 10, 2))).toBe(true);
    expect(eventOccursOnCalendarDay(game, new Date(2026, 10, 3))).toBe(false);

    // Ending exactly at Madison midnight does not spill onto the next day.
    const untilMidnight = { ...game, endsAt: "2026-11-03T06:00:00.000Z" };
    expect(eventSpansMultipleDays(untilMidnight)).toBe(false);
    expect(eventOccursOnCalendarDay(untilMidnight, new Date(2026, 10, 3))).toBe(false);

    // A true overnight shoot still reads as a range.
    const overnight = { ...game, endsAt: "2026-11-03T08:00:00.000Z" };
    expect(formatCalendarEventDateRange(overnight)).toBe("Nov 2-3");
    expect(sortCalendarEventsForDisplay([
      { id: "all-day-nov-3", startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-04T00:00:00.000Z", allDay: true },
      { id: "game", ...game },
    ]).map((event) => event.id)).toEqual(["game", "all-day-nov-3"]);
  });
});
