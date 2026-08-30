import { describe, expect, it } from "vitest";
import {
  chooseScheduleViewContextDate,
  chooseScheduleTimelineTarget,
  scheduleTimelineSnapshotDate,
  shouldKeepPreviousScheduleData,
  type ScheduleQueryScope,
  type ScheduleTimelineSnapshot,
} from "@/lib/schedule-timeline-position";

const snapshot: ScheduleTimelineSnapshot = {
  events: [
    { id: "away-event", offset: -24 },
    { id: "home-event", offset: 42 },
    { id: "later-home-event", offset: 108 },
  ],
  day: { value: 1_787_875_200_000, offset: -96 },
};

describe("Schedule timeline context", () => {
  it("keeps the first visible event that survives a filter", () => {
    expect(chooseScheduleTimelineTarget(
      snapshot,
      new Set(["home-event", "later-home-event"]),
      [],
    )).toEqual({ kind: "event", id: "home-event", offset: 42 });
  });

  it("falls back to the same day when every visible event is filtered out", () => {
    expect(chooseScheduleTimelineTarget(
      snapshot,
      new Set(),
      [snapshot.day!.value],
    )).toEqual({ kind: "day", value: snapshot.day!.value, offset: -96 });
  });

  it("uses the nearest surviving day when the original day disappears", () => {
    const previousDay = snapshot.day!.value - 86_400_000;
    const nextDay = snapshot.day!.value + 2 * 86_400_000;
    expect(chooseScheduleTimelineTarget(
      snapshot,
      new Set(),
      [previousDay, nextDay],
    )).toEqual({ kind: "day", value: previousDay, offset: -96 });
  });

  it("does not invent a target for an empty result", () => {
    expect(chooseScheduleTimelineTarget(snapshot, new Set(), [])).toBeNull();
  });
});

describe("Schedule query scope", () => {
  const listScope: ScheduleQueryScope = {
    viewMode: "list",
    includeArchived: false,
    sportFilter: "",
    dateRangeKey: "",
  };

  it("keeps rows only while the same list prepends older records", () => {
    expect(shouldKeepPreviousScheduleData(listScope, {
      ...listScope,
      includeArchived: true,
    })).toBe(true);
  });

  it("does not present the previous view, sport, or archive scope as current", () => {
    expect(shouldKeepPreviousScheduleData(listScope, {
      ...listScope,
      viewMode: "week",
    })).toBe(false);
    expect(shouldKeepPreviousScheduleData(listScope, {
      ...listScope,
      includeArchived: true,
      sportFilter: "FB",
    })).toBe(false);
    expect(shouldKeepPreviousScheduleData({ ...listScope, includeArchived: true }, listScope)).toBe(false);
  });
});

describe("Schedule view context", () => {
  function atDay(year: number, month: number, day: number) {
    return new Date(year, month - 1, day);
  }

  function daySnapshot(date: Date): ScheduleTimelineSnapshot {
    return { events: [], day: { value: date.getTime(), offset: 0 } };
  }

  it("turns a stored timeline day back into a local calendar date", () => {
    const date = atDay(2026, 9, 25);
    expect(scheduleTimelineSnapshotDate(daySnapshot(date))).toEqual(date);
    expect(scheduleTimelineSnapshotDate(null)).toBeNull();
  });

  it("carries a visible List day into the matching month and week", () => {
    const visibleDay = atDay(2026, 9, 25);
    const shared = {
      snapshot: daySnapshot(visibleDay),
      calMonth: atDay(2026, 9, 1),
      weekStart: atDay(2026, 9, 21),
      now: atDay(2026, 8, 30),
    };

    expect(chooseScheduleViewContextDate({ ...shared, viewMode: "calendar" })).toEqual(visibleDay);
    expect(chooseScheduleViewContextDate({ ...shared, viewMode: "week" })).toEqual(visibleDay);
  });

  it("uses today for a current period when the stored day is stale", () => {
    const today = atDay(2026, 8, 30);
    const stale = daySnapshot(atDay(2026, 5, 1));
    expect(chooseScheduleViewContextDate({
      viewMode: "calendar",
      snapshot: stale,
      calMonth: atDay(2026, 8, 1),
      weekStart: atDay(2026, 8, 24),
      now: today,
    })).toEqual(today);
    expect(chooseScheduleViewContextDate({
      viewMode: "week",
      snapshot: stale,
      calMonth: atDay(2026, 8, 1),
      weekStart: atDay(2026, 8, 24),
      now: today,
    })).toEqual(today);
  });

  it("uses the requested period start when neither stored day nor today belongs", () => {
    const stale = daySnapshot(atDay(2026, 5, 1));
    expect(chooseScheduleViewContextDate({
      viewMode: "calendar",
      snapshot: stale,
      calMonth: atDay(2026, 10, 1),
      weekStart: atDay(2026, 10, 12),
      now: atDay(2026, 8, 30),
    })).toEqual(atDay(2026, 10, 1));
    expect(chooseScheduleViewContextDate({
      viewMode: "week",
      snapshot: stale,
      calMonth: atDay(2026, 10, 1),
      weekStart: atDay(2026, 10, 12),
      now: atDay(2026, 8, 30),
    })).toEqual(atDay(2026, 10, 12));
  });
});
