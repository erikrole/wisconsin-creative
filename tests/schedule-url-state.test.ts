import { describe, expect, it } from "vitest";
import {
  parseScheduleDeepLink,
  parseScheduleMonth,
  parseScheduleViewMode,
  parseScheduleWeek,
  readScheduleUrlFilters,
  scheduleHref,
  withoutScheduleDateRange,
  withoutScheduleFilters,
  withScheduleQueue,
  writeScheduleUrlState,
  type ScheduleUrlState,
} from "@/lib/schedule-url-state";

const q = (query: string) => new URLSearchParams(query);

const listState: ScheduleUrlState = {
  viewMode: "list",
  calMonth: new Date(2026, 9, 1),
  weekStart: new Date(2026, 9, 19),
  sportFilter: "",
  areaFilter: "",
  coverageFilter: "",
  homeAwayFilter: "all",
  includeArchived: false,
  myShiftsOnly: false,
};

describe("Schedule URL state", () => {
  it("reads every list filter back from the query string", () => {
    expect(readScheduleUrlFilters(q("sportCode=FB&area=VIDEO&coverage=unfilled&venue=away&includeArchived=true&myShifts=true"))).toEqual({
      sportFilter: "FB",
      areaFilter: "VIDEO",
      coverageFilter: "unfilled",
      homeAwayFilter: "away",
      includeArchived: true,
      myShiftsOnly: true,
    });
  });

  it("falls back to the defaults for values it does not recognise", () => {
    expect(readScheduleUrlFilters(q("coverage=most&venue=moon&includeArchived=1&myShifts=yes"))).toEqual({
      sportFilter: "",
      areaFilter: "",
      coverageFilter: "",
      homeAwayFilter: "all",
      includeArchived: false,
      myShiftsOnly: false,
    });
    expect(parseScheduleViewMode("grid")).toBeNull();
    expect(parseScheduleMonth("2026-13")).toBeNull();
    expect(parseScheduleWeek("2026-02-30")).toBeNull();
  });

  it("snaps a linked week to its Monday", () => {
    expect(parseScheduleWeek("2026-10-22")).toEqual(new Date(2026, 9, 19));
    expect(parseScheduleMonth("2026-10")).toEqual(new Date(2026, 9, 1));
  });

  it("round-trips a filtered week view so detail -> Back lands on the same result", () => {
    const state: ScheduleUrlState = {
      ...listState,
      viewMode: "week",
      sportFilter: "WVB",
      areaFilter: "PHOTO",
      coverageFilter: "filled",
      homeAwayFilter: "home",
      includeArchived: true,
      myShiftsOnly: true,
    };

    const params = writeScheduleUrlState(q(""), state);

    expect(params.toString()).toBe("view=week&week=2026-10-19&sportCode=WVB&area=PHOTO&coverage=filled&venue=home&includeArchived=true&myShifts=true");
    expect(parseScheduleViewMode(params.get("view"))).toBe("week");
    expect(parseScheduleWeek(params.get("week"))).toEqual(state.weekStart);
    expect(readScheduleUrlFilters(params)).toEqual({
      sportFilter: "WVB",
      areaFilter: "PHOTO",
      coverageFilter: "filled",
      homeAwayFilter: "home",
      includeArchived: true,
      myShiftsOnly: true,
    });
  });

  it("drops the period parameter the current view does not own", () => {
    const fromWeek = q("view=week&week=2026-10-19");

    expect(writeScheduleUrlState(fromWeek, { ...listState, viewMode: "calendar" }).toString()).toBe("view=calendar&month=2026-10");
    expect(writeScheduleUrlState(fromWeek, listState).toString()).toBe("");
  });

  it("leaves parameters it does not own alone", () => {
    const params = writeScheduleUrlState(q("queue=needs-staffing&trades=open&startDate=a&endDate=b&area=VIDEO"), listState);

    expect(params.toString()).toBe("queue=needs-staffing&trades=open&startDate=a&endDate=b");
  });

  it("sets and clears a review queue without touching the rest", () => {
    const set = withScheduleQueue(q("sportCode=FB"), "needs-staffing");
    expect(set.toString()).toBe("sportCode=FB&queue=needs-staffing");
    expect(withScheduleQueue(set, null).toString()).toBe("sportCode=FB");
  });

  it("clears a date range on its own, and every narrowing filter on Clear all", () => {
    const query = q("view=week&week=2026-10-19&queue=needs-staffing&sportCode=FB&area=VIDEO&coverage=filled&venue=home&includeArchived=true&startDate=a&endDate=b&myShifts=true");

    expect(withoutScheduleDateRange(query).has("startDate")).toBe(false);
    expect(withoutScheduleDateRange(query).get("sportCode")).toBe("FB");
    // My Shifts is a personal preference, not a filter Clear all should undo.
    expect(withoutScheduleFilters(query).toString()).toBe("view=week&week=2026-10-19&myShifts=true");
  });

  it("builds a bare path when nothing is left", () => {
    expect(scheduleHref("/schedule", q(""))).toBe("/schedule");
    expect(scheduleHref("/schedule", q("view=week"))).toBe("/schedule?view=week");
  });
});

describe("Schedule deep links", () => {
  it("accepts My Shifts, a sport, and a well-ordered date range", () => {
    expect(parseScheduleDeepLink(q("myShifts=true&sportCode=FB&startDate=2026-11-01T05:00:00Z&endDate=2026-11-08T05:00:00Z"))).toEqual({
      myShiftsOnly: true,
      sportCode: "FB",
      dateRange: { startDate: "2026-11-01T05:00:00.000Z", endDate: "2026-11-08T05:00:00.000Z" },
    });
  });

  it("ignores a half, invalid, or backwards range", () => {
    for (const query of [
      "startDate=2026-11-01",
      "startDate=nope&endDate=2026-11-08",
      "startDate=2026-11-08&endDate=2026-11-01",
    ]) {
      expect(parseScheduleDeepLink(q(query)).dateRange, query).toBeNull();
    }
  });
});
