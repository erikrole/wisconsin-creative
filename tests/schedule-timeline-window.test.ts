import { describe, expect, it } from "vitest";
import {
  createInitialScheduleTimelineWindow,
  eventBoundsForGroups,
  mergeRowsById,
  newestScheduleCursor,
  oldestScheduleCursor,
  sliceHasMore,
} from "@/lib/schedule-timeline-window";

describe("schedule timeline window", () => {
  it("opens a today-centered first window", () => {
    const now = new Date("2026-09-18T15:00:00");
    const window = createInitialScheduleTimelineWindow(now);
    expect(window.start.getTime()).toBeLessThan(now.getTime());
    expect(window.end.getTime()).toBeGreaterThan(now.getTime());
    const spanDays = (window.end.getTime() - window.start.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThan(100);
    expect(spanDays).toBeLessThan(110);
  });

  it("keeps the first copy of a duplicated id", () => {
    expect(mergeRowsById(
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    )).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("names the oldest and newest cursors with an id tie-breaker", () => {
    const rows = [
      { id: "b", startsAt: "2026-09-18T12:00:00.000Z", endsAt: "2026-09-18T14:00:00.000Z" },
      { id: "a", startsAt: "2026-09-18T12:00:00.000Z", endsAt: "2026-09-18T13:00:00.000Z" },
      { id: "c", startsAt: "2026-09-19T12:00:00.000Z", endsAt: "2026-09-19T16:00:00.000Z" },
    ];
    expect(oldestScheduleCursor(rows)).toEqual({ startsAt: "2026-09-18T12:00:00.000Z", id: "a" });
    expect(newestScheduleCursor(rows)).toEqual({ startsAt: "2026-09-19T12:00:00.000Z", id: "c" });
    expect(eventBoundsForGroups(rows)).toEqual({
      startDate: "2026-09-18T12:00:00.000Z",
      endDate: "2026-09-19T16:00:00.000Z",
    });
  });

  it("treats a full slice as a signal that more rows exist", () => {
    expect(sliceHasMore(80)).toBe(true);
    expect(sliceHasMore(79)).toBe(false);
  });
});
