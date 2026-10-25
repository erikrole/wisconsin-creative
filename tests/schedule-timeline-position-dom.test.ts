import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureScheduleTimelinePosition,
  chooseScheduleViewContextDate,
  discardScheduleTimelinePosition,
  discardScheduleTimelineReadingPosition,
  readScheduleTimelinePosition,
  readScheduleTimelineReadingPosition,
  rememberScheduleTimelineReadingPosition,
  restoreScheduleTimelinePosition,
  saveScheduleTimelinePosition,
  scheduleTimelineSnapshotDate,
} from "@/lib/schedule-timeline-position";

type Rect = { top: number; bottom: number; width: number; height: number };
type FakeRow = { dataset: Record<string, string>; getBoundingClientRect: () => Rect };

const DAY = 1_787_875_200_000;

let rows: FakeRow[];
let stickyVar: string;
let frameBottom: number | null;
let storage: Map<string, string>;
let scrollTo: ReturnType<typeof vi.fn>;

function row(dataset: Record<string, string>, top: number, height = 40, width = 300): FakeRow {
  return { dataset, getBoundingClientRect: () => ({ top, bottom: top + height, width, height }) };
}

function event(id: string, top: number, height = 40) {
  return row({ scheduleEventId: id }, top, height);
}

function day(value: number, top: number, height = 200) {
  return row({ scheduleDay: String(value) }, top, height);
}

beforeEach(() => {
  rows = [];
  stickyVar = "100px";
  frameBottom = null;
  storage = new Map();
  scrollTo = vi.fn();
  vi.stubGlobal("window", { innerHeight: 800, scrollY: 500, scrollTo });
  vi.stubGlobal("document", {
    documentElement: {},
    querySelectorAll: (selector: string) => rows.filter((candidate) => (
      selector === "[data-schedule-event-id]" ? "scheduleEventId" in candidate.dataset : "scheduleDay" in candidate.dataset
    )),
    querySelector: () => (frameBottom === null ? null : { getBoundingClientRect: () => ({ bottom: frameBottom }) }),
  });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => ` ${stickyVar} ` }));
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capturing the schedule position", () => {
  it("records visible events below the sticky header, top first, and the day that owns the boundary", () => {
    rows = [
      event("above", 20),
      event("second", 300),
      event("first", 120),
      event("below-fold", 900),
      row({ scheduleEventId: "hidden" }, 150, 0, 0),
      day(DAY - 86_400_000, -100, 150),
      day(DAY, 50, 400),
      day(DAY + 86_400_000, 450),
    ];

    const snapshot = captureScheduleTimelinePosition();

    expect(snapshot).toEqual({
      events: [{ id: "first", offset: 20 }, { id: "second", offset: 200 }],
      day: { value: DAY, offset: -50 },
    });
    expect(readScheduleTimelinePosition()).toEqual(snapshot);
  });

  it("prefers a day header sitting on the boundary over the sliver above it", () => {
    rows = [day(DAY - 86_400_000, -100, 203), day(DAY, 101)];

    expect(captureScheduleTimelinePosition()?.day).toEqual({ value: DAY, offset: 1 });
  });

  it("uses the first day below the header when none spans it", () => {
    rows = [day(DAY, 300), day(DAY + 86_400_000, 600)];

    expect(captureScheduleTimelinePosition()?.day).toEqual({ value: DAY, offset: 200 });
  });

  it("keeps at most eight events", () => {
    rows = Array.from({ length: 12 }, (_, index) => event(`e${index}`, 110 + index * 50));

    expect(captureScheduleTimelinePosition()?.events).toHaveLength(8);
  });

  it("uses the live sticky frame edge when it sits below the published one", () => {
    stickyVar = "";
    frameBottom = 160;
    rows = [event("first", 180)];

    expect(captureScheduleTimelinePosition()?.events).toEqual([{ id: "first", offset: 20 }]);
  });

  it("returns nothing when no row is on screen", () => {
    rows = [event("off", 1000), day(DAY, 1200)];

    expect(captureScheduleTimelinePosition()).toBeNull();
    expect(readScheduleTimelinePosition()).toBeNull();
  });

  it("keeps the reading position apart from the transition position", () => {
    rows = [event("reading", 150)];

    rememberScheduleTimelineReadingPosition();

    expect(readScheduleTimelineReadingPosition()?.events).toEqual([{ id: "reading", offset: 50 }]);
    expect(readScheduleTimelinePosition()).toBeNull();
    discardScheduleTimelineReadingPosition();
    expect(readScheduleTimelineReadingPosition()).toBeNull();
  });

  it("returns nothing when storage refuses the write", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("quota"); } });
    rows = [event("first", 150)];

    expect(captureScheduleTimelinePosition()).toBeNull();
    expect(rememberScheduleTimelineReadingPosition()).toBeNull();
  });
});

describe("reading a stored position", () => {
  it.each([
    ["broken JSON", "{"],
    ["no event list", JSON.stringify({ day: null })],
    ["an event without an offset", JSON.stringify({ events: [{ id: "a" }], day: null })],
    ["a day that is not a number", JSON.stringify({ events: [], day: { value: "x", offset: 0 } })],
  ])("ignores %s", (_label, raw) => {
    storage.set("schedule:timeline-transition", raw);

    expect(readScheduleTimelinePosition()).toBeNull();
  });

  it("round-trips a saved snapshot and forgets it on discard", () => {
    const snapshot = { events: [{ id: "a", offset: 4 }], day: null };
    expect(saveScheduleTimelinePosition(snapshot)).toBe(true);
    expect(readScheduleTimelinePosition()).toEqual(snapshot);

    discardScheduleTimelinePosition();

    expect(readScheduleTimelinePosition()).toBeNull();
  });

  it("does nothing without storage", () => {
    vi.stubGlobal("sessionStorage", undefined);

    expect(saveScheduleTimelinePosition({ events: [], day: null })).toBe(false);
    expect(readScheduleTimelinePosition()).toBeNull();
    expect(() => discardScheduleTimelinePosition()).not.toThrow();
  });
});

describe("restoring the schedule position", () => {
  it("scrolls the saved event back to its offset under the header", () => {
    rows = [event("kept", 400)];

    expect(restoreScheduleTimelinePosition({ events: [{ id: "gone", offset: 0 }, { id: "kept", offset: 20 }], day: null })).toBe(true);

    expect(scrollTo).toHaveBeenCalledWith({ top: 780, behavior: "instant" });
  });

  it("falls back to the nearest day and never scrolls above the page", () => {
    rows = [day(DAY + 86_400_000, 50)];

    expect(restoreScheduleTimelinePosition({ events: [{ id: "gone", offset: 0 }], day: { value: DAY, offset: 600 } })).toBe(true);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("leaves the page alone when already in place or when nothing matches", () => {
    rows = [event("kept", 120.5)];
    expect(restoreScheduleTimelinePosition({ events: [{ id: "kept", offset: 20 }], day: null })).toBe(true);

    expect(restoreScheduleTimelinePosition({ events: [{ id: "gone", offset: 0 }], day: null })).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing on the server", () => {
    vi.stubGlobal("window", undefined);

    expect(restoreScheduleTimelinePosition({ events: [], day: null })).toBe(false);
    expect(captureScheduleTimelinePosition()).toBeNull();
  });
});

describe("choosing the view's context date", () => {
  const now = new Date(2026, 9, 25, 14, 30);
  const snapshotOn = (date: Date) => ({ events: [], day: { value: date.getTime(), offset: 0 } });

  it("reads the snapshot day at local midnight", () => {
    expect(scheduleTimelineSnapshotDate(snapshotOn(new Date(2026, 10, 3, 18)))).toEqual(new Date(2026, 10, 3));
    expect(scheduleTimelineSnapshotDate({ events: [], day: { value: Number.MAX_VALUE, offset: 0 } })).toBeNull();
    expect(scheduleTimelineSnapshotDate(null)).toBeNull();
  });

  it("uses the snapshot day, then today, then the first of the month in calendar view", () => {
    const calMonth = new Date(2026, 10, 1);
    const weekStart = new Date(2026, 9, 25);

    expect(chooseScheduleViewContextDate({ viewMode: "calendar", snapshot: snapshotOn(new Date(2026, 10, 12)), calMonth, weekStart, now })).toEqual(new Date(2026, 10, 12));
    expect(chooseScheduleViewContextDate({ viewMode: "calendar", snapshot: snapshotOn(new Date(2026, 11, 2)), calMonth, weekStart, now })).toEqual(new Date(2026, 10, 1));
    expect(chooseScheduleViewContextDate({ viewMode: "calendar", snapshot: null, calMonth: new Date(2026, 9, 1), weekStart, now })).toEqual(new Date(2026, 9, 25));
  });

  it("uses the snapshot day, then today, then the week start in week view", () => {
    const weekStart = new Date(2026, 10, 1, 9);
    const calMonth = new Date(2026, 10, 1);

    expect(chooseScheduleViewContextDate({ viewMode: "week", snapshot: snapshotOn(new Date(2026, 10, 7, 23)), calMonth, weekStart, now })).toEqual(new Date(2026, 10, 7));
    expect(chooseScheduleViewContextDate({ viewMode: "week", snapshot: snapshotOn(new Date(2026, 10, 8)), calMonth, weekStart, now })).toEqual(new Date(2026, 10, 1));
    expect(chooseScheduleViewContextDate({ viewMode: "week", snapshot: null, calMonth, weekStart: new Date(2026, 9, 22), now })).toEqual(new Date(2026, 9, 25));
  });
});
