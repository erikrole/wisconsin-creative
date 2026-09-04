import { describe, expect, it } from "vitest";
import { deriveFromPrimary } from "@/components/create-booking/use-event-context";
import type { CalendarEvent } from "@/components/booking-list/types";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    summary: "Football Media Day Shoot",
    startsAt: new Date(2026, 6, 7).toISOString(),
    endsAt: new Date(2026, 6, 9).toISOString(),
    allDay: true,
    sportCode: null,
    isHome: null,
    opponent: null,
    rawLocationText: null,
    location: { id: "loc-1", name: "Camp Randall" },
    ...overrides,
  };
}

describe("booking defaults from linked all-day events", () => {
  it("uses the full all-day event span without timed game buffers", () => {
    const result = deriveFromPrimary([event()], "");

    expect(result.title).toBe("Football Media Day Shoot");
    expect(result.startsAt).toBe("2026-07-07T00:00");
    expect(result.endsAt).toBe("2026-07-09T00:00");
    expect("locationId" in result).toBe(false);
  });

  it("keeps non-game event summaries even when sport metadata exists", () => {
    const result = deriveFromPrimary([
      event({
        summary: "Men's Basketball Mini Media Day",
        sportCode: "MBB",
      }),
    ], "");

    expect(result.title).toBe("Men's Basketball Mini Media Day");
  });

  it("keeps existing timed-event buffers for timed events", () => {
    const result = deriveFromPrimary([
      event({
        startsAt: "2026-07-07T18:00:00.000Z",
        endsAt: "2026-07-07T21:00:00.000Z",
        allDay: false,
      }),
    ], "");

    expect(result.startsAt).not.toBe("2026-07-07T18:00");
    expect(result.endsAt).not.toBe("2026-07-07T21:00");
  });
});
