import { describe, expect, it } from "vitest";
import { buildWorkingSchedulePayload } from "@/lib/services/schedule-working-copy";

function group(source: "MANUAL" | "RESERVATION", bookings: number) {
  return {
    event: {
      startsAt: new Date("2026-10-13T23:30:00Z"),
      endsAt: new Date("2026-10-14T03:30:00Z"),
    },
    shifts: [{
      id: "shift-1",
      area: "VIDEO",
      workerType: "ST",
      startsAt: new Date("2026-10-13T22:00:00Z"),
      endsAt: new Date("2026-10-14T03:30:00Z"),
      callStartsAt: null,
      callEndsAt: null,
      notes: null,
      _count: { assignments: 1 },
      assignments: [{
        id: "assignment-1",
        userId: "user-1",
        status: "DIRECT_ASSIGNED",
        source,
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        trades: [],
        _count: { bookings },
      }],
    }],
  } as never;
}

describe("working schedule booking links", () => {
  it("does not let a reservation-created assignment's booking block unassigning", () => {
    const payload = buildWorkingSchedulePayload(group("RESERVATION", 1));
    expect(payload.slots[0]?.assignment?.bookingCount).toBe(0);
  });

  it("still blocks unassigning staff-made assignments that have a booking", () => {
    const payload = buildWorkingSchedulePayload(group("MANUAL", 1));
    expect(payload.slots[0]?.assignment?.bookingCount).toBe(1);
  });
});
