import { describe, it, expect } from "vitest";
import {
  startOfTodayInAppTz,
  startOfDayInAppTz,
  normalizeAllDayToUtcMidnight,
  formatAllDayDate,
  appTzDateKey,
  academicYearEnd,
  appTzDayRange,
  appTzWeekday,
  startOfAppWeek,
  endOfAppWeek,
  startOfAppMonth,
  endOfAppMonth,
} from "@/lib/app-time";

describe("startOfTodayInAppTz", () => {
  it("returns Central (CDT) midnight for a summer-morning UTC instant", () => {
    // 6:47am CDT on Jun 17 → start of today is Jun 17 00:00 CDT = 05:00Z.
    const now = new Date("2026-06-17T11:47:00Z");
    expect(startOfTodayInAppTz(now, "America/Chicago").toISOString()).toBe(
      "2026-06-17T05:00:00.000Z",
    );
  });

  it("uses the Central calendar day, not the UTC one, in the evening", () => {
    // 9pm CDT on Jun 16 (= 02:00Z Jun 17). "Today" is still Jun 16 locally.
    const now = new Date("2026-06-17T02:00:00Z");
    expect(startOfTodayInAppTz(now, "America/Chicago").toISOString()).toBe(
      "2026-06-16T05:00:00.000Z",
    );
  });

  it("handles standard time (CST, UTC-6)", () => {
    const now = new Date("2026-01-15T12:00:00Z"); // 6am CST Jan 15
    expect(startOfTodayInAppTz(now, "America/Chicago").toISOString()).toBe(
      "2026-01-15T06:00:00.000Z",
    );
  });
});

describe("startOfDayInAppTz (offset)", () => {
  it("returns start of tomorrow in the app timezone", () => {
    const now = new Date("2026-06-17T11:47:00Z"); // Jun 17 CDT
    expect(startOfDayInAppTz(now, 1, "America/Chicago").toISOString()).toBe(
      "2026-06-18T05:00:00.000Z",
    );
  });
});

describe("normalizeAllDayToUtcMidnight", () => {
  it("maps a Central (CDT) midnight encoding to UTC midnight of the same date", () => {
    // Lambeau-shaped: 2026-06-17T05:00Z is midnight CDT on Jun 17.
    expect(
      normalizeAllDayToUtcMidnight(new Date("2026-06-17T05:00:00Z"), "America/Chicago").toISOString(),
    ).toBe("2026-06-17T00:00:00.000Z");
  });

  it("is idempotent for an already-UTC-midnight instant (ICS shape)", () => {
    expect(
      normalizeAllDayToUtcMidnight(new Date("2026-06-17T00:00:00Z"), "America/Chicago").toISOString(),
    ).toBe("2026-06-17T00:00:00.000Z");
  });

  it("handles standard time (CST, UTC-6)", () => {
    expect(
      normalizeAllDayToUtcMidnight(new Date("2026-01-15T06:00:00Z"), "America/Chicago").toISOString(),
    ).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("formatAllDayDate", () => {
  it("reads an all-day boundary in UTC, where it was encoded", () => {
    // All-day events are stored at UTC midnight of their calendar date.
    // Reading this one in Central would report Aug 22.
    const allDay = new Date("2026-08-23T00:00:00Z");
    expect(formatAllDayDate(allDay)).toBe("Sun, Aug 23");
  });
});

describe("appTzDateKey", () => {
  it("files an evening instant under the Central day, not the UTC one", () => {
    // 7pm CDT Aug 23 = 00:00Z Aug 24.
    expect(appTzDateKey(new Date("2026-08-24T00:00:00Z"), "America/Chicago")).toBe("2026-08-23");
  });

  it("agrees with UTC once the Central day has caught up", () => {
    expect(appTzDateKey(new Date("2026-08-23T18:00:00Z"), "America/Chicago")).toBe("2026-08-23");
  });

  it("handles standard time", () => {
    // 6pm CST Jan 15 = 00:00Z Jan 16.
    expect(appTzDateKey(new Date("2026-01-16T00:00:00Z"), "America/Chicago")).toBe("2026-01-15");
  });
});

describe("appTzDayRange", () => {
  it("spans Central midnight to Central midnight in summer (CDT)", () => {
    const range = appTzDayRange("2026-08-23", "America/Chicago");
    expect(range.gte.toISOString()).toBe("2026-08-23T05:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-08-24T05:00:00.000Z");
  });

  it("spans Central midnight to Central midnight in winter (CST)", () => {
    const range = appTzDayRange("2026-01-15", "America/Chicago");
    expect(range.gte.toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-01-16T06:00:00.000Z");
  });

  it("covers a 23-hour spring-forward day without gaps", () => {
    // US DST begins Mar 8 2026.
    const range = appTzDayRange("2026-03-08", "America/Chicago");
    expect(range.gte.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-03-09T05:00:00.000Z");
  });
});

describe("Madison week and month", () => {
  it("keeps Sunday evening in the week that started the previous Monday", () => {
    // Sun Oct 11, 2026, 8:00pm CDT = Mon Oct 12, 01:00 UTC.
    const now = new Date("2026-10-12T01:00:00.000Z");
    expect(appTzWeekday(now, "America/Chicago")).toBe(0);
    expect(startOfAppWeek(now, "America/Chicago").toISOString()).toBe("2026-10-05T05:00:00.000Z");
    expect(endOfAppWeek(now, "America/Chicago").toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(startOfAppMonth(now, "America/Chicago").toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(endOfAppMonth(now, "America/Chicago").toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("starts a winter month at Central midnight, including the year boundary", () => {
    // Thu Dec 31, 2026, 11:00pm CST = Fri Jan 1, 2027, 05:00 UTC.
    const now = new Date("2027-01-01T05:00:00.000Z");
    expect(startOfAppWeek(now, "America/Chicago").toISOString()).toBe("2026-12-28T06:00:00.000Z");
    expect(endOfAppWeek(now, "America/Chicago").toISOString()).toBe("2027-01-04T06:00:00.000Z");
    expect(startOfAppMonth(now, "America/Chicago").toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(endOfAppMonth(now, "America/Chicago").toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });
});

describe("academicYearEnd", () => {
  it("rolls to the next academic year on August 1 in Chicago, not in UTC", () => {
    // 9 PM CDT on July 31 is already August 1 in UTC.
    expect(academicYearEnd(new Date("2026-08-01T02:00:00Z"))).toBe(2026);
    expect(academicYearEnd(new Date("2026-08-01T05:00:00Z"))).toBe(2027);
    expect(academicYearEnd(new Date("2027-03-15T12:00:00Z"))).toBe(2027);
  });
});
