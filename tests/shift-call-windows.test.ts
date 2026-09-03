import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  effectiveCallWindow,
  formatCallTime,
  formatCallWindow,
  isFullDayBoundaryWindow,
  isInheritedFullDayCallWindow,
  summarizeEffectiveCallWindows,
  studentCallTimeAppliesToEvent,
  toDateTimeLocalValue,
  dateTimeLocalToIso,
} from "@/lib/shift-call-windows";

describe("shift call-window helpers", () => {
  const shift = {
    startsAt: "2026-07-07T13:00:00.000Z",
    endsAt: "2026-07-07T16:00:00.000Z",
    callStartsAt: "2026-07-07T12:30:00.000Z",
    callEndsAt: "2026-07-07T15:30:00.000Z",
  };

  it("uses assignment override before slot and default windows", () => {
    expect(effectiveCallWindow(shift, {
      callStartsAt: "2026-07-07T14:15:00.000Z",
      callEndsAt: "2026-07-07T15:30:00.000Z",
    })).toEqual({
      startsAt: "2026-07-07T14:15:00.000Z",
      endsAt: "2026-07-07T15:30:00.000Z",
      source: "assignment",
    });
  });

  it("uses slot override before generated/default shift window", () => {
    expect(effectiveCallWindow(shift)).toEqual({
      startsAt: "2026-07-07T12:30:00.000Z",
      endsAt: "2026-07-07T15:30:00.000Z",
      source: "slot",
    });
  });

  it("falls back to generated/default shift window when no override pair exists", () => {
    expect(effectiveCallWindow({
      startsAt: "2026-07-07T13:00:00.000Z",
      endsAt: "2026-07-07T16:00:00.000Z",
      callStartsAt: null,
      callEndsAt: null,
    }, { callStartsAt: null, callEndsAt: null })).toEqual({
      startsAt: "2026-07-07T13:00:00.000Z",
      endsAt: "2026-07-07T16:00:00.000Z",
      source: "default",
    });
  });

  it("formats visible call time as one start time while retaining full window formatting", () => {
    const window = {
      startsAt: "2026-07-07T12:30:00.000Z",
      endsAt: "2026-07-07T15:30:00.000Z",
    };

    expect(formatCallTime(window)).not.toContain(" - ");
    expect(formatCallWindow(window)).toContain(" - ");
  });

  it("summarizes mixed effective call times instead of one false shared label", () => {
    const summary = summarizeEffectiveCallWindows([
      effectiveCallWindow(shift),
      effectiveCallWindow(shift, {
        callStartsAt: "2026-07-07T14:15:00.000Z",
        callEndsAt: "2026-07-07T15:30:00.000Z",
      }),
    ]);

    expect(summary.mixed).toBe(true);
    expect(summary.label).toBe("Mixed call times");
    expect(summary.title).toContain("Slot:");
    expect(summary.title).toContain("Personal:");
  });

  it("hides inherited midnight-to-midnight windows for all-day event chrome", () => {
    // Real full-day boundaries are always UTC midnight (ICS all-day parsing
    // uses Date.UTC), not local midnight — a local-time constructor here
    // only coincidentally matched isFullDayBoundaryWindow's old (buggy)
    // local-hours check.
    const startsAt = new Date(Date.UTC(2026, 5, 17)).toISOString();
    const endsAt = new Date(Date.UTC(2026, 5, 18)).toISOString();
    const summary = summarizeEffectiveCallWindows([
      {
        startsAt,
        endsAt,
        source: "default",
      },
    ], { hideInheritedFullDayWindows: true });

    expect(summary).toEqual({ label: null, title: null, mixed: false });
  });

  it("keeps explicit all-day call overrides visible", () => {
    const summary = summarizeEffectiveCallWindows([
      {
        startsAt: "2026-06-17T14:00:00.000Z",
        endsAt: "2026-06-17T18:00:00.000Z",
        source: "slot",
      },
    ], { hideInheritedFullDayWindows: true });

    expect(summary.label).toContain("Call");
    expect(summary.title).toContain("Slot call window:");
  });

  it("suppresses all call-window labels when the owning event is all-day", () => {
    const summary = summarizeEffectiveCallWindows([
      {
        startsAt: "2026-06-17T13:00:00.000Z",
        endsAt: "2026-06-18T00:00:00.000Z",
        source: "slot",
      },
      {
        startsAt: "2026-06-17T14:00:00.000Z",
        endsAt: "2026-06-17T18:00:00.000Z",
        source: "assignment",
      },
    ], { hideAllDayEventWindows: true });

    expect(summary).toEqual({ label: null, title: null, mixed: false });
  });

  it("round-trips datetime-local values through ISO strings", () => {
    const localValue = toDateTimeLocalValue("2026-07-07T14:15:00.000Z");
    expect(localValue).toMatch(/^2026-07-07T\d{2}:15$/);
    expect(dateTimeLocalToIso(localValue)).toMatch(/2026-07-07T/);
  });

  it("allows call times only for Home and opponent-free non-game events", () => {
    expect(studentCallTimeAppliesToEvent({ site: "HOME", opponent: "Iowa" })).toBe(true);
    expect(studentCallTimeAppliesToEvent({ site: "AWAY", opponent: "Iowa" })).toBe(false);
    expect(studentCallTimeAppliesToEvent({ site: "NEUTRAL", opponent: "Iowa" })).toBe(false);
    expect(studentCallTimeAppliesToEvent({ site: null, isHome: false, opponent: null })).toBe(true);
  });

  it("uses the canonical site when legacy isHome disagrees", () => {
    expect(studentCallTimeAppliesToEvent({ site: "AWAY", isHome: true, opponent: "Iowa" })).toBe(false);
    expect(studentCallTimeAppliesToEvent({ site: "HOME", isHome: false, opponent: "Iowa" })).toBe(true);
  });
});

// ── REGRESSION: isFullDayBoundaryWindow must detect the UTC-midnight
// default window in every process timezone, not just UTC. It previously
// checked local hours, so in Central time (a genuine UTC-midnight instant
// reads as 19:00 local) it always returned false, leaking a meaningless
// clock time — "Call Jul 8, 7:00 PM" for a Thursday event — into any UI
// that renders the inherited full-day default. ──
describe("isFullDayBoundaryWindow timezone independence", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/Chicago";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("detects a UTC-midnight-to-midnight span as full-day in Central time", () => {
    expect(
      isFullDayBoundaryWindow({
        startsAt: "2026-07-09T00:00:00.000Z",
        endsAt: "2026-07-10T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("detects a multi-day full-day span (e.g. a 2-day all-day event)", () => {
    expect(
      isFullDayBoundaryWindow({
        startsAt: "2026-07-09T00:00:00.000Z",
        endsAt: "2026-07-11T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not misdetect a real clock-time window as full-day", () => {
    expect(
      isFullDayBoundaryWindow({
        startsAt: "2026-07-09T19:00:00.000Z",
        endsAt: "2026-07-10T02:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("isInheritedFullDayCallWindow only fires for default-source full-day windows", () => {
    const fullDayWindow = {
      startsAt: "2026-07-09T00:00:00.000Z",
      endsAt: "2026-07-10T00:00:00.000Z",
      source: "default" as const,
    };
    expect(isInheritedFullDayCallWindow(fullDayWindow)).toBe(true);
    expect(isInheritedFullDayCallWindow({ ...fullDayWindow, source: "slot" })).toBe(false);
  });
});
