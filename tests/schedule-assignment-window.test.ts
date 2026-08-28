import { describe, expect, it } from "vitest";
import {
  ACADEMIC_TERMS,
  academicTermForDayKey,
  ASSIGNMENT_PERIODS,
  resolveAssignmentWindow,
  resolveAssignmentWindows,
} from "@/lib/schedule-assignment-window";
import { appTzDateKey } from "@/lib/app-time";

/** Central time: a mid-day UTC instant is unambiguously the same calendar day. */
function noonUtc(iso: string) {
  return new Date(`${iso}T18:00:00.000Z`);
}

function endDayKey(window: { rangeEndsAt: string }) {
  // The window end is exclusive midnight, so the last covered day is the
  // instant one millisecond earlier.
  return appTzDateKey(new Date(new Date(window.rangeEndsAt).getTime() - 1));
}

describe("schedule assignment windows", () => {
  it("always starts at today and never reaches into the past", () => {
    const now = noonUtc("2026-08-28");
    for (const window of resolveAssignmentWindows(now)) {
      expect(appTzDateKey(new Date(window.rangeStartsAt))).toBe("2026-08-28");
      expect(new Date(window.rangeEndsAt).getTime()).toBeGreaterThan(new Date(window.rangeStartsAt).getTime());
    }
  });

  it("runs the week through the coming Sunday", () => {
    // 2026-08-28 is a Friday.
    expect(endDayKey(resolveAssignmentWindow("week", noonUtc("2026-08-28")))).toBe("2026-08-30");
    // A Sunday covers only itself.
    expect(endDayKey(resolveAssignmentWindow("week", noonUtc("2026-08-30")))).toBe("2026-08-30");
    // A Monday covers the full Monday-Sunday week.
    expect(endDayKey(resolveAssignmentWindow("week", noonUtc("2026-08-31")))).toBe("2026-09-06");
  });

  it("runs the month through its last day, including February in a leap year", () => {
    expect(endDayKey(resolveAssignmentWindow("month", noonUtc("2026-08-28")))).toBe("2026-08-31");
    expect(endDayKey(resolveAssignmentWindow("month", noonUtc("2028-02-03")))).toBe("2028-02-29");
  });

  it("ends the fall semester on December 20", () => {
    const window = resolveAssignmentWindow("semester", noonUtc("2026-09-15"));
    expect(endDayKey(window)).toBe("2026-12-20");
    expect(window.detail).toContain("Fall semester");
    expect(window.detail).toContain("Dec 20");
  });

  it("keeps the late-December tail in the fall term rather than jumping back", () => {
    // Dec 21-31 falls past the fall end date but still belongs to that term.
    expect(academicTermForDayKey("2026-12-27").id).toBe("FALL");
    expect(endDayKey(resolveAssignmentWindow("semester", noonUtc("2026-12-27")))).toBe("2027-12-20");
  });

  it("resolves spring and summer semesters from their own boundaries", () => {
    expect(endDayKey(resolveAssignmentWindow("semester", noonUtc("2027-02-10")))).toBe("2027-05-15");
    expect(endDayKey(resolveAssignmentWindow("semester", noonUtc("2027-06-01")))).toBe("2027-08-19");
  });

  it("runs the season to the day before the next July 1 rollover", () => {
    expect(endDayKey(resolveAssignmentWindow("season", noonUtc("2026-08-28")))).toBe("2027-06-30");
    // Before the rollover, the season still closes this calendar year.
    expect(endDayKey(resolveAssignmentWindow("season", noonUtc("2027-03-04")))).toBe("2027-06-30");
    // On rollover day the new season opens.
    expect(endDayKey(resolveAssignmentWindow("season", noonUtc("2027-07-01")))).toBe("2028-06-30");
  });

  it("tiles the whole calendar year with academic terms", () => {
    const days = ["01-01", "05-15", "05-16", "08-19", "08-20", "12-20", "12-31"];
    for (const monthDay of days) {
      expect(ACADEMIC_TERMS).toContain(academicTermForDayKey(`2026-${monthDay}`));
    }
  });

  it("labels every preset", () => {
    for (const period of ASSIGNMENT_PERIODS) {
      const window = resolveAssignmentWindow(period, noonUtc("2026-08-28"));
      expect(window.label.length).toBeGreaterThan(0);
      expect(window.detail).toContain("through");
    }
  });
});
