import { describe, expect, it } from "vitest";
import {
  buildShiftAssignmentOverlapWhere,
  resolveEffectiveAssignmentWindow,
  resolveEffectiveShiftWindow,
  scheduleWindowDurationHours,
  scheduleWindowsOverlap,
} from "@/lib/schedule-window";

const eventWindow = {
  startsAt: new Date("2026-09-05T00:00:00.000Z"),
  endsAt: new Date("2026-09-07T00:00:00.000Z"),
  allDay: true,
};

function shift(overrides: Record<string, unknown> = {}) {
  return {
    startsAt: new Date("2026-09-05T18:00:00.000Z"),
    endsAt: new Date("2026-09-05T22:00:00.000Z"),
    callStartsAt: null,
    callEndsAt: null,
    shiftGroup: { event: eventWindow },
    ...overrides,
  };
}

describe("schedule window helpers", () => {
  it("uses a complete shift call window before the event or shift boundaries", () => {
    expect(resolveEffectiveShiftWindow(shift({
      callStartsAt: new Date("2026-09-05T16:00:00.000Z"),
      callEndsAt: new Date("2026-09-05T17:00:00.000Z"),
    }))).toEqual({
      startsAt: new Date("2026-09-05T16:00:00.000Z"),
      endsAt: new Date("2026-09-05T17:00:00.000Z"),
    });
  });

  it("falls back as a pair when only one call boundary is present", () => {
    expect(resolveEffectiveShiftWindow(shift({
      callStartsAt: new Date("2026-09-05T16:00:00.000Z"),
    }))).toEqual({
      startsAt: eventWindow.startsAt,
      endsAt: eventWindow.endsAt,
    });
  });

  it("uses canonical UTC date boundaries for inherited all-day event windows", () => {
    expect(resolveEffectiveShiftWindow(shift())).toEqual({
      startsAt: eventWindow.startsAt,
      endsAt: eventWindow.endsAt,
    });
  });

  it("lets an assignment call window override the shift window", () => {
    expect(resolveEffectiveAssignmentWindow({
      callStartsAt: new Date("2026-09-05T19:00:00.000Z"),
      callEndsAt: new Date("2026-09-05T20:00:00.000Z"),
      shift: shift(),
    })).toEqual({
      startsAt: new Date("2026-09-05T19:00:00.000Z"),
      endsAt: new Date("2026-09-05T20:00:00.000Z"),
    });
  });

  it("uses half-open overlap semantics and computes non-negative duration", () => {
    const first = {
      startsAt: new Date("2026-09-05T10:00:00.000Z"),
      endsAt: new Date("2026-09-05T12:00:00.000Z"),
    };
    const touching = {
      startsAt: first.endsAt,
      endsAt: new Date("2026-09-05T14:00:00.000Z"),
    };

    expect(scheduleWindowsOverlap(first, touching)).toBe(false);
    expect(scheduleWindowsOverlap(first, {
      startsAt: new Date("2026-09-05T11:00:00.000Z"),
      endsAt: new Date("2026-09-05T13:00:00.000Z"),
    })).toBe(true);
    expect(scheduleWindowDurationHours(first)).toBe(2);
    expect(scheduleWindowDurationHours({ startsAt: first.endsAt, endsAt: first.startsAt })).toBe(0);
  });

  it("builds a broad, all-day-aware assignment prefilter and preserves exclusion", () => {
    const window = {
      startsAt: new Date("2026-09-05T16:00:00.000Z"),
      endsAt: new Date("2026-09-05T20:00:00.000Z"),
    };
    const where = buildShiftAssignmentOverlapWhere({
      userId: "user-1",
      window,
      excludeAssignmentId: "assignment-1",
    });

    expect(where).toEqual(expect.objectContaining({
      userId: "user-1",
      status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
      id: { not: "assignment-1" },
    }));
    expect(where.OR).toHaveLength(4);
    expect(where.OR).toContainEqual(expect.objectContaining({
      shift: expect.objectContaining({
        shiftGroup: expect.objectContaining({
          event: expect.objectContaining({ allDay: true }),
        }),
      }),
    }));
  });
});
