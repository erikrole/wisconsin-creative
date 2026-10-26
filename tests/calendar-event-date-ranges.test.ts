import { describe, expect, it } from "vitest";
import {
  eventOccursOnCalendarDay,
  eventSpansMultipleDays,
  formatCalendarEventAllDayLabel,
  formatCalendarEventDateRange,
} from "@/lib/calendar-event-dates";

// vitest.setup pins TZ to America/Chicago, so timed events read as Central time.
const allDay = (startsAt: string, endsAt: string) => ({ startsAt, endsAt, allDay: true });
const timed = (startsAt: string, endsAt: string) => ({ startsAt, endsAt, allDay: false });

describe("formatCalendarEventDateRange for all-day events", () => {
  it("formats a single day, with and without the year", () => {
    const event = allDay("2026-10-24T00:00:00Z", "2026-10-25T00:00:00Z");

    expect(formatCalendarEventDateRange(event)).toBe("Oct 24");
    expect(formatCalendarEventDateRange(event, { includeYear: true })).toBe("Oct 24, 2026");
    expect(formatCalendarEventAllDayLabel(event)).toBe("All day");
  });

  it("treats an end at or before the start as one day", () => {
    expect(formatCalendarEventDateRange(allDay("2026-10-24T00:00:00Z", "2026-10-24T00:00:00Z"))).toBe("Oct 24");
    expect(eventSpansMultipleDays(allDay("2026-10-24T00:00:00Z", "2026-10-23T00:00:00Z"))).toBe(false);
  });

  it("shortens ranges inside a month or a year", () => {
    expect(formatCalendarEventDateRange(allDay("2026-10-24T00:00:00Z", "2026-10-27T00:00:00Z"), { includeYear: true })).toBe("Oct 24-26, 2026");
    expect(formatCalendarEventDateRange(allDay("2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z"))).toBe("Oct 30-Nov 2");
    expect(formatCalendarEventDateRange(allDay("2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z"), { includeYear: true })).toBe("Oct 30-Nov 2, 2026");
    expect(formatCalendarEventDateRange(allDay("2026-12-30T00:00:00Z", "2027-01-02T00:00:00Z"))).toBe("Dec 30, 2026-Jan 1, 2027");
    expect(formatCalendarEventAllDayLabel(allDay("2026-10-24T00:00:00Z", "2026-10-27T00:00:00Z"))).toBe("All day Oct 24-26");
  });
});

describe("formatCalendarEventDateRange for timed events", () => {
  it("uses the Central day, not the UTC one", () => {
    // 9 PM Central on the 24th is already the 25th in UTC.
    const lateGame = timed("2026-10-25T02:00:00Z", "2026-10-25T04:30:00Z");

    expect(formatCalendarEventDateRange(lateGame)).toBe("Oct 24");
    expect(formatCalendarEventDateRange(lateGame, { includeYear: true })).toBe("Oct 24, 2026");
    expect(eventSpansMultipleDays(lateGame)).toBe(false);
    expect(formatCalendarEventAllDayLabel(lateGame)).toBe("");
  });

  it("shortens multi-day trips inside a month or a year", () => {
    expect(formatCalendarEventDateRange(timed("2026-10-23T14:00:00Z", "2026-10-25T20:00:00Z"))).toBe("Oct 23-25");
    expect(formatCalendarEventDateRange(timed("2026-10-23T14:00:00Z", "2026-10-25T20:00:00Z"), { includeYear: true })).toBe("Oct 23-25, 2026");
    expect(formatCalendarEventDateRange(timed("2026-10-30T14:00:00Z", "2026-11-02T20:00:00Z"))).toBe("Oct 30-Nov 2");
    expect(formatCalendarEventDateRange(timed("2026-10-30T14:00:00Z", "2026-11-02T20:00:00Z"), { includeYear: true })).toBe("Oct 30-Nov 2, 2026");
    expect(formatCalendarEventDateRange(timed("2026-12-30T14:00:00Z", "2027-01-02T20:00:00Z"))).toBe("Dec 30, 2026-Jan 2, 2027");
  });
});

describe("eventOccursOnCalendarDay for timed events", () => {
  const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);

  it("covers every Central day the event touches", () => {
    const trip = timed("2026-10-23T14:00:00Z", "2026-10-25T20:00:00Z");

    expect(eventOccursOnCalendarDay(trip, day(2026, 10, 22))).toBe(false);
    expect(eventOccursOnCalendarDay(trip, day(2026, 10, 23))).toBe(true);
    expect(eventOccursOnCalendarDay(trip, day(2026, 10, 25))).toBe(true);
    expect(eventOccursOnCalendarDay(trip, day(2026, 10, 26))).toBe(false);
  });

  it("does not spill into the next day when it ends exactly at midnight", () => {
    const evening = timed("2026-10-24T23:00:00Z", "2026-10-25T05:00:00Z");

    expect(eventOccursOnCalendarDay(evening, day(2026, 10, 24))).toBe(true);
    expect(eventOccursOnCalendarDay(evening, day(2026, 10, 25))).toBe(false);
  });
});
