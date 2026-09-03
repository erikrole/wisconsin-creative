import { describe, expect, it } from "vitest";
import {
  combinedScheduleSuggestionKey,
  suggestCombinedScheduleEventPairs,
  type CombineSuggestionEvent,
} from "@/lib/combined-schedule-event-suggestions";

function event(overrides: Partial<CombineSuggestionEvent> = {}): CombineSuggestionEvent {
  return {
    id: "cmevent000000000000000001",
    summary: "Women's Cross Country vs Badger Classic",
    startsAt: "2026-09-04T15:00:00.000Z",
    endsAt: "2026-09-04T18:00:00.000Z",
    allDay: false,
    sportCode: "WXC",
    opponent: "Badger Classic",
    combinedIntoId: null,
    combinedEventCount: 1,
    location: null,
    rawLocationText: "Madison, Wis., Zimmer Championship Course",
    ...overrides,
  };
}

describe("combined Schedule event suggestions", () => {
  it("suggests a future same-day Cross Country pair at the same overlapping venue", () => {
    const result = suggestCombinedScheduleEventPairs([
      event(),
      event({
        id: "cmevent000000000000000002",
        summary: "Men's Cross Country vs Badger Classic",
        sportCode: "MXC",
        startsAt: "2026-09-04T15:45:00.000Z",
        endsAt: "2026-09-04T18:45:00.000Z",
        rawLocationText: "Madison, WI, Zimmer Championship Course",
      }),
    ], new Date("2026-09-03T12:00:00.000Z"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sportFamily: "Cross Country",
      first: { id: "cmevent000000000000000001" },
      second: { id: "cmevent000000000000000002" },
    });
    expect(combinedScheduleSuggestionKey(result[0]!)).toBe("cmevent000000000000000001:cmevent000000000000000002");
  });

  it("does not suggest pairs from another venue, day, or sport family", () => {
    const result = suggestCombinedScheduleEventPairs([
      event(),
      event({ id: "other-venue", sportCode: "MXC", rawLocationText: "McClimon Track" }),
      event({ id: "other-day", sportCode: "MXC", startsAt: "2026-09-05T15:00:00.000Z", endsAt: "2026-09-05T18:00:00.000Z" }),
      event({ id: "other-sport", sportCode: "WSOC" }),
    ], new Date("2026-09-03T12:00:00.000Z"));

    expect(result).toEqual([]);
  });

  it("omits already combined and ended events", () => {
    const result = suggestCombinedScheduleEventPairs([
      event({ endsAt: "2026-09-02T18:00:00.000Z" }),
      event({ id: "combined", sportCode: "MXC", combinedIntoId: "parent" }),
    ], new Date("2026-09-03T12:00:00.000Z"));

    expect(result).toEqual([]);
  });
});
