import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { filterScheduleEntries, groupScheduleEntriesByDay, type ScheduleEntryFilters } from "@/lib/schedule-entry-view";

function entry(id: string, startsAt: string, overrides: Record<string, unknown> = {}): CalendarEntry {
  return {
    id,
    summary: id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 2 * 3_600_000).toISOString(),
    allDay: false,
    opponent: "Iowa",
    isHome: true,
    site: null,
    shifts: [],
    coverage: null,
    ...overrides,
  } as unknown as CalendarEntry;
}

function crewed(userId: string, status: string, area = "VIDEO") {
  return [{ id: `s-${userId}`, area, assignments: [{ status, user: { id: userId } }] }];
}

const noFilters: ScheduleEntryFilters = {
  myShiftsOnly: false,
  currentUserId: "me",
  homeAwayFilter: "all",
  areaFilter: "",
  coverageFilter: "",
  queue: null,
  health: null,
  staleSourceIds: new Set(),
};

describe("filterScheduleEntries", () => {
  const mine = entry("mine", "2026-10-23T17:00:00Z", { shifts: crewed("me", "APPROVED", "PHOTO"), coverage: { percentage: 100 } });
  const requested = entry("requested", "2026-10-22T17:00:00Z", { shifts: crewed("me", "REQUESTED"), coverage: { percentage: 50 } });
  const away = entry("away", "2026-10-21T17:00:00Z", { site: "AWAY", coverage: null });

  it("sorts what it keeps into display order", () => {
    expect(filterScheduleEntries([mine, requested, away], noFilters).map((e) => e.id)).toEqual(["away", "requested", "mine"]);
  });

  it("counts only held shifts as mine", () => {
    // A pending request is not a shift the student works.
    expect(filterScheduleEntries([mine, requested, away], { ...noFilters, myShiftsOnly: true }).map((e) => e.id)).toEqual(["mine"]);
  });

  it("narrows by venue, area and coverage", () => {
    expect(filterScheduleEntries([mine, requested, away], { ...noFilters, homeAwayFilter: "away" }).map((e) => e.id)).toEqual(["away"]);
    expect(filterScheduleEntries([mine, requested, away], { ...noFilters, areaFilter: "PHOTO" }).map((e) => e.id)).toEqual(["mine"]);
    // No crew at all counts as unfilled.
    expect(filterScheduleEntries([mine, requested, away], { ...noFilters, coverageFilter: "unfilled" }).map((e) => e.id)).toEqual(["away", "requested"]);
    expect(filterScheduleEntries([mine, requested, away], { ...noFilters, coverageFilter: "filled" }).map((e) => e.id)).toEqual(["mine"]);
  });

  it("applies the review queue on top of the other filters", () => {
    const result = filterScheduleEntries([mine, requested, away], { ...noFilters, homeAwayFilter: "home", queue: "pending-requests" });
    expect(result.map((e) => e.id)).toEqual(["requested"]);
  });
});

describe("groupScheduleEntriesByDay", () => {
  const now = new Date("2026-10-22T15:00:00Z");
  const entries = [
    entry("past", "2026-10-20T17:00:00Z"),
    entry("next-1", "2026-10-24T17:00:00Z"),
    entry("next-2", "2026-10-24T23:00:00Z"),
  ];

  it("groups consecutive entries under their day", () => {
    const groups = groupScheduleEntriesByDay(entries, { isTimeline: false, now });
    expect(groups.map(([day, rows]) => [day, rows.map((e) => e.id)])).toEqual([
      ["Tue Oct 20 2026", ["past"]],
      ["Sat Oct 24 2026", ["next-1", "next-2"]],
    ]);
  });

  it("gives the timeline an empty today row to anchor on, in date order", () => {
    const groups = groupScheduleEntriesByDay(entries, { isTimeline: true, now });
    expect(groups.map(([day, rows]) => [day, rows.length])).toEqual([
      ["Tue Oct 20 2026", 1],
      ["Thu Oct 22 2026", 0],
      ["Sat Oct 24 2026", 2],
    ]);
  });

  it("puts today last when everything loaded is in the past, and alone when nothing is", () => {
    expect(groupScheduleEntriesByDay([entries[0]!], { isTimeline: true, now }).map(([day]) => day)).toEqual(["Tue Oct 20 2026", "Thu Oct 22 2026"]);
    expect(groupScheduleEntriesByDay([], { isTimeline: true, now })).toEqual([["Thu Oct 22 2026", []]]);
  });

  it("does not invent a today row inside a deep-linked range", () => {
    expect(groupScheduleEntriesByDay(entries, { isTimeline: false, now }).some(([day]) => day === "Thu Oct 22 2026")).toBe(false);
  });

  it("does not add a second today row when today has events", () => {
    const today = entry("today", "2026-10-22T17:00:00Z");
    const groups = groupScheduleEntriesByDay([entries[0]!, today], { isTimeline: true, now });
    expect(groups.filter(([day]) => day === "Thu Oct 22 2026")).toEqual([["Thu Oct 22 2026", [today]]]);
  });
});
