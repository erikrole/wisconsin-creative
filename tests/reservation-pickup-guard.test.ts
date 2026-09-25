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

describe("findLeftoverReservationPickup scope", () => {
  const now = new Date("2026-09-24T18:00:00Z");

  function fakeBookings(rows: Array<Record<string, unknown>>) {
    // Minimal in-memory evaluation of the where clause the guard sends, so the
    // test proves which reservations are excluded rather than echoing a query.
    const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => {
      if (where.requesterUserId !== undefined && row.requesterUserId !== where.requesterUserId) return false;
      if (where.custodyScope !== undefined && row.custodyScope !== where.custodyScope) return false;
      if (where.kind !== undefined && row.kind !== where.kind) return false;
      if (where.status !== undefined && row.status !== where.status) return false;
      if (where.locationId !== undefined && row.locationId !== where.locationId) return false;
      const endsAt = where.endsAt as { gt?: Date } | undefined;
      if (endsAt?.gt && !((row.endsAt as Date) > endsAt.gt)) return false;
      return true;
    }));
    return { booking: { findMany } } as never;
  }

  const leftover = {
    requesterUserId: "user-1",
    custodyScope: "PERSON",
    kind: "RESERVATION",
    status: "BOOKED",
    locationId: "loc-1",
    serializedItems: [{ allocationStatus: "active" }],
    bulkItems: [],
    derivedCheckouts: [{ id: "co-1" }],
  };

  it("does not block direct checkout for a leftover reservation whose window has ended", async () => {
    const tx = fakeBookings([
      { ...leftover, id: "rv-ended", refNumber: "RV-0001", title: "Ended", endsAt: new Date("2026-09-24T17:59:59Z") },
      { ...leftover, id: "rv-edge", refNumber: "RV-0002", title: "Edge", endsAt: now },
    ]);
    await expect(findLeftoverReservationPickup(tx, {
      requesterUserId: "user-1",
      locationId: "loc-1",
      now,
    })).resolves.toBeNull();
  });

  it("still blocks for an unended leftover personal reservation", async () => {
    const tx = fakeBookings([
      { ...leftover, id: "rv-live", refNumber: "RV-0003", title: "Live", endsAt: new Date("2026-09-24T20:00:00Z") },
    ]);
    await expect(findLeftoverReservationPickup(tx, {
      requesterUserId: "user-1",
      locationId: "loc-1",
      now,
    })).resolves.toEqual({ id: "rv-live", refNumber: "RV-0003", title: "Live" });
  });

  it("ignores a SHARED travel-case reservation whose retained requester is this person", async () => {
    const tx = fakeBookings([
      {
        ...leftover,
        custodyScope: "SHARED",
        id: "rv-shared",
        refNumber: "RV-0004",
        title: "Football Travel Case",
        endsAt: new Date("2026-09-25T20:00:00Z"),
      },
    ]);
    await expect(findLeftoverReservationPickup(tx, {
      requesterUserId: "user-1",
      locationId: "loc-1",
      now,
    })).resolves.toBeNull();
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
