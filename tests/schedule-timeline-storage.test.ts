import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readScheduleTimelinePosition,
  readScheduleTimelineReadingPosition,
  discardScheduleTimelinePosition,
  discardScheduleTimelineReadingPosition,
  saveScheduleTimelinePosition,
} from "@/lib/schedule-timeline-position";

afterEach(() => vi.unstubAllGlobals());

describe("optional timeline storage", () => {
  it("keeps navigation usable when storage methods throw", () => {
    const denied = () => { throw new Error("Storage unavailable"); };
    vi.stubGlobal("sessionStorage", { getItem: denied, setItem: denied, removeItem: denied });
    expect(readScheduleTimelinePosition()).toBeNull();
    expect(readScheduleTimelineReadingPosition()).toBeNull();
    expect(saveScheduleTimelinePosition({ events: [], day: null })).toBe(false);
    expect(() => discardScheduleTimelinePosition()).not.toThrow();
    expect(() => discardScheduleTimelineReadingPosition()).not.toThrow();
  });

  it("ignores corrupted snapshots and preserves valid zero offsets", () => {
    const getItem = vi.fn().mockReturnValueOnce("not json").mockReturnValueOnce(JSON.stringify({ events: [{ id: "event", offset: 0 }], day: null }));
    vi.stubGlobal("sessionStorage", { getItem });
    expect(readScheduleTimelinePosition()).toBeNull();
    expect(readScheduleTimelinePosition()).toEqual({ events: [{ id: "event", offset: 0 }], day: null });
  });
});
