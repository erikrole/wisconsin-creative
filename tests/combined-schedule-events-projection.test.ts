import { describe, expect, it } from "vitest";
import type { CalendarEvent, ShiftGroup } from "@/app/(app)/schedule/_components/types";
import { mergeScheduleData } from "@/hooks/use-schedule-data";

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "cmevent000000000000000001",
    summary: "Women's Cross Country vs Badger Classic",
    startsAt: "2026-09-04T15:00:00.000Z",
    endsAt: "2026-09-04T18:00:00.000Z",
    allDay: false,
    status: "CONFIRMED",
    rawLocationText: "Madison, WI, Zimmer Championship Course",
    sportCode: "WXC",
    opponent: "Badger Classic",
    isHome: true,
    site: "HOME",
    subtitle: null,
    location: null,
    source: null,
    combinedIntoId: null,
    combinedEvents: [],
    ...overrides,
  };
}

describe("combined Schedule event projection", () => {
  it("collapses the secondary row, spans both windows, and keeps the primary crew", () => {
    const secondary = calendarEvent({
      id: "cmevent000000000000000002",
      summary: "Men's Cross Country vs Badger Classic",
      sportCode: "MXC",
      startsAt: "2026-09-04T15:45:00.000Z",
      endsAt: "2026-09-04T18:45:00.000Z",
      combinedIntoId: "cmevent000000000000000001",
    });
    const primary = calendarEvent({
      combinedEvents: [{
        id: secondary.id,
        summary: secondary.summary,
        startsAt: secondary.startsAt,
        endsAt: secondary.endsAt,
        allDay: secondary.allDay,
        sportCode: secondary.sportCode,
        opponent: secondary.opponent,
      }],
    });
    const primaryGroup = {
      id: "cmgroup00000000000000001",
      eventId: primary.id,
      notes: null,
      event: { id: primary.id, startsAt: primary.startsAt },
      shifts: [],
      coverage: { total: 3, filled: 3, percentage: 100 },
    } satisfies ShiftGroup;

    const result = mergeScheduleData([primary, secondary], [primaryGroup]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: primary.id,
      startsAt: "2026-09-04T15:00:00.000Z",
      endsAt: "2026-09-04T18:45:00.000Z",
      shiftGroupId: primaryGroup.id,
      combinedEventCount: 2,
      coverage: { total: 3, filled: 3, percentage: 100 },
    });
  });
});
