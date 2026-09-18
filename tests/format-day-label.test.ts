import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  calendarDate,
  formatDayLabel,
  formatOperationalDateTime,
} from "@/lib/format";

// ── REGRESSION: an all-day CalendarEvent stores its date as UTC midnight
// (e.g. "2026-07-09T00:00:00Z" for July 9). Formatting that instant in a
// non-UTC local timezone shifts it to the previous evening — in Central
// time it reads as "Wednesday, Jul 8" for what is actually a Thursday,
// July 9 event. formatDayLabel must read UTC date parts for allDay values,
// same as formatDateShort already does via calendarDate. ──
describe("formatDayLabel / calendarDate timezone independence", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/Chicago";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  const now = new Date("2026-07-06T12:00:00.000Z"); // a Monday, well before the event

  it("shows the correct weekday for a UTC-midnight all-day event in Central time", () => {
    const label = formatDayLabel("2026-07-09T00:00:00.000Z", now, true);
    expect(label).toBe("Thursday, Jul 9");
  });

  it("would show the wrong day without the allDay flag (documents the bug shape)", () => {
    const label = formatDayLabel("2026-07-09T00:00:00.000Z", now, false);
    expect(label).toBe("Wednesday, Jul 8");
  });

  it("still resolves Today/Tomorrow correctly for an all-day event", () => {
    const todayNow = new Date("2026-07-09T15:00:00.000Z"); // Thursday afternoon UTC
    expect(formatDayLabel("2026-07-09T00:00:00.000Z", todayNow, true)).toBe("Today");
    expect(formatDayLabel("2026-07-10T00:00:00.000Z", todayNow, true)).toBe("Tomorrow");
  });

  it("calendarDate reads UTC date parts for allDay values regardless of local timezone", () => {
    const d = calendarDate("2026-07-09T00:00:00.000Z", true);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(9);
  });

  it("calendarDate passes non-allDay values through untouched", () => {
    const d = calendarDate("2026-07-09T19:00:00.000Z", false);
    expect(d.toISOString()).toBe("2026-07-09T19:00:00.000Z");
  });
});

describe("formatOperationalDateTime", () => {
  const now = new Date(2026, 6, 24, 10, 0);

  function localIso(year: number, month: number, day: number, hour = 14, minute = 30) {
    return new Date(year, month, day, hour, minute).toISOString();
  }

  it("uses nearby calendar-day labels with a comma before the time", () => {
    expect(formatOperationalDateTime(localIso(2026, 6, 23), now)).toBe("Yesterday, 2:30 PM");
    expect(formatOperationalDateTime(localIso(2026, 6, 24), now)).toBe("Today, 2:30 PM");
    expect(formatOperationalDateTime(localIso(2026, 6, 25), now)).toBe("Tomorrow, 2:30 PM");
  });

  it("uses a full month and day outside the relative range", () => {
    expect(formatOperationalDateTime(localIso(2026, 6, 29), now)).toBe("July 29, 2:30 PM");
  });

  it("can use a short month on dense surfaces", () => {
    expect(formatOperationalDateTime(localIso(2026, 6, 29), now, { month: "short" })).toBe("Jul 29, 2:30 PM");
  });

  it("includes the year when the timestamp is outside the current year", () => {
    expect(formatOperationalDateTime(localIso(2027, 0, 2), now)).toBe("January 2, 2027, 2:30 PM");
  });
});
