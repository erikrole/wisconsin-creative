import { describe, expect, it } from "vitest";
import { dayHeading } from "@/app/(app)/_home/home-model";
import { formatOperationalDateTime, institutionDayOffset } from "@/lib/format";

// Fri Oct 23, 1:45 PM CDT. Volleyball at 7 PM CDT is 00:00Z Oct 24, which is
// "tomorrow" on a UTC server clock but still tonight in Madison.
const now = new Date("2026-10-23T18:45:00Z");
const volleyball = "2026-10-24T00:00:00Z";
const football = "2026-10-24T16:00:00Z";

describe("institution-day labels", () => {
  it("counts days on the Central calendar", () => {
    expect(institutionDayOffset(volleyball, now)).toBe(0);
    expect(institutionDayOffset(football, now)).toBe(1);
    expect(institutionDayOffset("2026-10-23T04:59:00Z", now)).toBe(-1);
  });

  it("labels the Dashboard Coming up rows Today and Tomorrow", () => {
    expect(dayHeading(volleyball, now)).toBe("Today");
    expect(dayHeading(football, now)).toBe("Tomorrow");
  });

  it("labels operational times the same way", () => {
    expect(formatOperationalDateTime(volleyball, now)).toMatch(/^Today, /);
    expect(formatOperationalDateTime(football, now)).toMatch(/^Tomorrow, /);
  });

  it("stays correct across the November DST change", () => {
    const sat = new Date("2026-11-01T17:00:00Z"); // Sun Nov 1, 11 AM CST
    expect(institutionDayOffset("2026-11-02T05:30:00Z", sat)).toBe(0);
    expect(institutionDayOffset("2026-11-02T06:00:00Z", sat)).toBe(1);
  });
});
