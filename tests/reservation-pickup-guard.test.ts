import { describe, expect, it, vi } from "vitest";
import {
  findLeftoverReservationPickup,
  leftoverReservationPickupConflict,
} from "@/lib/services/reservation-pickup-guard";

describe("findLeftoverReservationPickup", () => {
  it("returns a booked reservation that already opened custody and still has remaining gear", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "rv-1",
        refNumber: "RV-0453",
        title: "WBB Practice",
        serializedItems: [{ allocationStatus: "active" }],
        bulkItems: [],
        derivedCheckouts: [{ id: "co-1" }],
      },
    ]);

    await expect(findLeftoverReservationPickup(
      { booking: { findMany } } as never,
      { requesterUserId: "user-1", locationId: "loc-1" },
    )).resolves.toEqual({
      id: "rv-1",
      refNumber: "RV-0453",
      title: "WBB Practice",
    });
  });

  it("ignores a reservation that has not started pickup yet", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "rv-2",
        refNumber: "RV-0002",
        title: "Later practice",
        serializedItems: [{ allocationStatus: "active" }],
        bulkItems: [],
        derivedCheckouts: [],
      },
    ]);

    await expect(findLeftoverReservationPickup(
      { booking: { findMany } } as never,
      { requesterUserId: "user-1", locationId: "loc-1" },
    )).resolves.toBeNull();
  });
});

describe("leftoverReservationPickupConflict", () => {
  it("names the reservation that still needs pickup", () => {
    const error = leftoverReservationPickupConflict({
      id: "rv-1",
      refNumber: "RV-0453",
      title: "WBB Practice",
    });
    expect(error.status).toBe(409);
    expect(error.message).toBe("Finish pickup for RV-0453 first instead of starting a new checkout.");
    expect(error.data).toEqual({
      errorCode: "leftover_reservation_pickup",
      reservationId: "rv-1",
      refNumber: "RV-0453",
    });
  });
});
