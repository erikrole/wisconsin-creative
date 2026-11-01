import { describe, expect, it } from "vitest";
import {
  formatChipTime,
  formatCountdown,
  formatCountdownCompact,
  formatDateFull,
  formatDateRange,
  formatDateTime,
  formatDateWithDayTime,
  formatDayLabel,
  formatDueLabel,
  formatDuration,
  formatMinutes,
  formatOperationalDateTime,
  formatPercent,
  formatRelativeTime,
  formatStartsIn,
  getUrgency,
  institutionDateKey,
  isDueToday,
  isStartingToday,
  pad2,
  pluralWord,
  pluralize,
} from "@/lib/format";

// Tests run in America/Chicago (vitest.config.ts). Noon CDT on Friday, Oct 23, 2026.
const now = new Date("2026-10-23T17:00:00.000Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("counts", () => {
  it("pluralizes, pads and rounds", () => {
    expect([pluralize(1, "item"), pluralize(0, "item"), pluralize(2, "battery", "batteries")]).toEqual(["1 item", "0 items", "2 batteries"]);
    expect([pluralWord(1, "kit"), pluralWord(3, "kit")]).toEqual(["kit", "kits"]);
    expect([pad2(7), pad2(12)]).toEqual(["07", "12"]);
    expect(formatPercent(0.256)).toBe("26%");
  });

  it("writes call-time offsets in minutes and hours", () => {
    expect([0, 45, 60, 120, 90].map(formatMinutes)).toEqual(["None", "45min", "1 hr", "2 hrs", "1h 30m"]);
  });
});

describe("urgency and countdowns", () => {
  const start = at(-9 * HOUR);

  it("rates urgency by the share of the checkout left", () => {
    expect(getUrgency(start, at(-1), now)).toBe("overdue");
    expect(getUrgency(at(HOUR), at(HOUR), now)).toBe("critical"); // a zero-length window
    expect(getUrgency(start, at(1 * HOUR), now)).toBe("critical"); // 10% left
    expect(getUrgency(start, at(2 * HOUR), now)).toBe("warning"); // ~18% left
    expect(getUrgency(start, at(9 * HOUR), now)).toBe("normal");
  });

  it("spells out the time left or overdue", () => {
    expect(formatCountdown(at(2 * DAY + 3 * HOUR + 5 * MIN), now)).toBe("DUE BACK IN 2 days 3 hours");
    expect(formatCountdown(at(-(1 * HOUR + 1 * MIN)), now)).toBe("OVERDUE BY 1 hour 1 minute");
    expect(formatCountdown(at(30_000), now)).toBe("DUE BACK IN less than a minute");
    expect(formatCountdown(at(1 * DAY), now)).toBe("DUE BACK IN 1 day");
  });

  it("shortens the countdown for badges", () => {
    expect(formatCountdownCompact(at(2 * DAY + 23 * HOUR), now)).toBe("2d 23h left");
    expect(formatCountdownCompact(at(2 * DAY), now)).toBe("2d left");
    expect(formatCountdownCompact(at(5 * HOUR + 12 * MIN), now)).toBe("5h 12m left");
    expect(formatCountdownCompact(at(5 * HOUR), now)).toBe("5h left");
    expect(formatCountdownCompact(at(-8 * MIN), now)).toBe("Overdue 8m");
    expect(formatCountdownCompact(at(0), now)).toBe("Overdue <1m");
  });

  it("labels due times as overdue, a countdown within a week, or a date", () => {
    expect(formatDueLabel(at(-(3 * DAY + 2 * HOUR)), now)).toBe("3 days 2 hours overdue");
    expect(formatDueLabel(at(5 * HOUR + 12 * MIN), now)).toBe("Due in 5 hours 12 minutes");
    expect(formatDueLabel(at(3 * DAY), now)).toBe("Due in 3 days");
    expect(formatDueLabel("2026-11-05T18:00:00.000Z", now)).toBe("Due Nov 5");
  });

  it("says when a reservation starts or started", () => {
    expect(formatStartsIn(at(3 * HOUR), now)).toBe("Starts in 3h");
    expect(formatStartsIn(at(30 * MIN), now)).toBe("Starts in 30m");
    expect(formatStartsIn(at(-2 * DAY), now)).toBe("Started 2d ago");
  });
});

describe("relative times and durations", () => {
  it("counts back to a week, then shows the date", () => {
    expect(formatRelativeTime(at(-30_000), now)).toBe("just now");
    expect(formatRelativeTime(at(-5 * MIN), now)).toBe("5m ago");
    expect(formatRelativeTime(at(-2 * HOUR), now)).toBe("2h ago");
    expect(formatRelativeTime(at(-3 * DAY), now)).toBe("3d ago");
    expect(formatRelativeTime(at(-10 * DAY), now)).toBe("Oct 13");
  });

  it("rounds a booking length to the largest unit", () => {
    expect(formatDuration(at(0), at(-1))).toBe("—");
    expect(formatDuration(at(0), at(30 * MIN))).toBe("30 min");
    expect(formatDuration(at(0), at(HOUR))).toBe("1 hour");
    expect(formatDuration(at(0), at(5 * HOUR))).toBe("5 hours");
    expect(formatDuration(at(0), at(DAY))).toBe("1 day");
    expect(formatDuration(at(0), at(3 * DAY))).toBe("3 days");
  });
});

describe("Madison calendar days", () => {
  // 10:30 PM CDT Friday is already Saturday in UTC.
  const lateFriday = new Date("2026-10-24T03:30:00.000Z");

  it("keeps a late-evening due time on today", () => {
    expect(isDueToday("2026-10-24T04:30:00.000Z", lateFriday)).toBe(true); // 11:30 PM Friday
    expect(isDueToday("2026-10-24T05:30:00.000Z", lateFriday)).toBe(false); // 12:30 AM Saturday
    expect(isStartingToday("2026-10-23T14:00:00.000Z", lateFriday)).toBe(true);
    expect(institutionDateKey(lateFriday)).toBe("2026-10-23");
  });

  it("labels operational times by Madison day, adding the year when it differs", () => {
    expect(formatOperationalDateTime("2026-10-24T04:30:00.000Z", lateFriday)).toBe("Today, 11:30 PM");
    expect(formatOperationalDateTime("2026-10-24T15:00:00.000Z", lateFriday)).toBe("Tomorrow, 10:00 AM");
    expect(formatOperationalDateTime("2026-10-22T15:00:00.000Z", lateFriday)).toBe("Yesterday, 10:00 AM");
    expect(formatOperationalDateTime("2026-07-29T19:30:00.000Z", lateFriday, { month: "short" })).toBe("Jul 29, 2:30 PM");
    expect(formatOperationalDateTime("2027-01-05T19:30:00.000Z", lateFriday)).toBe("January 5, 2027, 1:30 PM");
  });
});

describe("display dates", () => {
  const iso = "2026-03-11T20:00:00.000Z"; // 3:00 PM CDT, Wednesday

  it("formats full dates, date-times and chips", () => {
    expect(formatDateFull(iso)).toBe("Mar 11, 2026");
    expect(formatDateFull(null)).toBe("—");
    // A calendar day stored as UTC midnight keeps its day instead of sliding to the evening before.
    expect(formatDateFull("2026-10-25T00:00:00.000Z")).toBe("Oct 24, 2026");
    expect(formatDateFull("2026-10-25T00:00:00.000Z", true)).toBe("Oct 25, 2026");
    expect(formatDateTime(iso)).toBe("Mar 11, 2026, 3:00 PM");
    expect(formatChipTime(iso)).toBe("Wed 3:00 pm");
    expect(formatDateWithDayTime(iso)).toEqual({ date: "Mar 11, 2026", dayTime: "Wednesday 3:00 PM" });
  });

  it("collapses a same-day range", () => {
    expect(formatDateRange(iso, "2026-03-11T23:00:00.000Z")).toBe("Mar 11");
    expect(formatDateRange(iso, "2026-03-14T20:00:00.000Z")).toBe("Mar 11 – Mar 14");
  });
});

describe("Madison evenings", () => {
  // The unit workers run on the Madison clock; the end-to-end flow suite renders
  // the same helpers on a UTC server and checks the Schedule for a stray day range.
  it("stay on their Madison day", () => {
    const eightPmMonday = "2026-11-03T02:00:00.000Z"; // Nov 2, 8:00 PM CST
    expect(formatDateFull(eightPmMonday)).toBe("Nov 2, 2026");
    expect(formatDateWithDayTime(eightPmMonday)).toEqual({ date: "Nov 2, 2026", dayTime: "Monday 8:00 PM" });
    expect(formatDateRange("2026-11-02T23:00:00.000Z", eightPmMonday)).toBe("Nov 2");
    expect(formatDayLabel(eightPmMonday, new Date("2026-11-01T06:00:00.000Z"))).toBe("Tomorrow");
    expect(formatDayLabel(eightPmMonday, new Date("2026-10-20T12:00:00.000Z"))).toBe("Monday, Nov 2");
    // An all-day date is a calendar day already; "today" still comes from the Madison clock.
    expect(formatDayLabel("2026-11-02T00:00:00.000Z", new Date("2026-11-02T03:00:00.000Z"), true)).toBe("Tomorrow");
  });
});

