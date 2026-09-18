import { beforeEach, describe, expect, it, vi } from "vitest";

const { bookingFindMany, kioskFindMany } = vi.hoisted(() => ({
  bookingFindMany: vi.fn(),
  kioskFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: bookingFindMany },
    kioskDevice: { findMany: kioskFindMany },
  },
}));

import { projectionForRole } from "@/lib/companion-projection-contract";
import { buildCompanionProjection } from "@/lib/services/companion-projection";
import { shouldPublishCompanionProjection } from "@/lib/services/companion-projection-publisher";

const now = new Date("2026-08-09T18:00:00.000Z");

describe("companion projection", () => {
  beforeEach(() => {
    bookingFindMany.mockReset();
    kioskFindMany.mockReset();
  });

  it("builds the complete menu-bar read model in two bounded database reads", async () => {
    bookingFindMany.mockResolvedValue([
      {
        id: "checkout-1",
        title: "Women's Soccer vs Tcu",
        kind: "CHECKOUT",
        status: "OPEN",
        startsAt: new Date("2026-08-09T15:00:00.000Z"),
        endsAt: new Date("2026-08-09T17:00:00.000Z"),
        updatedAt: now,
        refNumber: "C-1",
        requester: { id: "user-1", name: "Erik", avatarUrl: null },
        location: { id: "loc-1", name: "Kohl Center" },
        serializedItems: [{
          id: "item-1",
          asset: { assetTag: "CAM-1", name: "FX3", brand: "Sony", model: "FX3", type: "Camera" },
        }],
        bulkItems: [{
          id: "bulk-1",
          plannedQuantity: 4,
          checkedOutQuantity: 4,
          bulkSku: { name: "NP-FZ100" },
        }],
      },
      {
        id: "reservation-1",
        title: "Pickup",
        kind: "RESERVATION",
        status: "BOOKED",
        startsAt: new Date("2026-08-09T17:30:00.000Z"),
        endsAt: new Date("2026-08-10T18:00:00.000Z"),
        updatedAt: now,
        refNumber: "R-1",
        requester: { id: "user-2", name: "Bucky", avatarUrl: null },
        location: { id: "loc-1", name: "Kohl Center" },
        serializedItems: [],
        bulkItems: [],
      },
      {
        id: "draft-1",
        title: "Unfinished draft",
        kind: "RESERVATION",
        status: "DRAFT",
        startsAt: new Date("2026-08-10T17:30:00.000Z"),
        endsAt: new Date("2026-08-10T18:00:00.000Z"),
        updatedAt: now,
        refNumber: null,
        requester: { id: "user-1", name: "Erik", avatarUrl: null },
        location: { id: "loc-1", name: "Kohl Center" },
        serializedItems: [],
        bulkItems: [],
      },
    ]);
    kioskFindMany.mockResolvedValue([
      {
        id: "kiosk-1",
        name: "Kohl Center Kiosk",
        locationId: "loc-1",
        location: { id: "loc-1", name: "Kohl Center" },
        active: true,
        activatedAt: now,
        lastSeenAt: now,
        appVersion: "1.0",
        appBuild: "1",
        osVersion: "26.0",
        deviceModel: "iPad",
      },
    ]);

    const projection = await buildCompanionProjection(now);

    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    expect(kioskFindMany).toHaveBeenCalledTimes(1);
    expect(projection.stats.checkedOut).toBe(1);
    expect(projection.stats.overdue).toBe(1);
    expect(projection.pendingPickupTotal).toBe(1);
    expect(projection.bookingActivity.every((booking) => booking.status !== "DRAFT")).toBe(true);
    expect(projection.openBookings.map((booking) => booking.id)).toEqual(["checkout-1"]);
    expect(projection.openBookings[0]?.title).toBe("Women's Soccer vs TCU");
    expect(projection.openBookings[0]?.serializedItems).toEqual([
      { id: "item-1", name: "FX3", assetTag: "CAM-1" },
    ]);
    expect(projection.openBookings[0]?.bulkItems).toEqual([
      { id: "bulk-1", name: "NP-FZ100", quantity: 4 },
    ]);
    expect(projection.bookingActivity.find((booking) => booking.id === "checkout-1")?.title)
      .toBe("Women's Soccer vs TCU");
    expect(projection.bookingActivity.find((booking) => booking.id === "checkout-1")?.serializedItems)
      .toEqual([{ id: "item-1", name: "FX3", assetTag: "CAM-1" }]);
    expect(projection.kioskDevices[0]).toMatchObject({
      pendingPickupCount: 1,
      openCheckoutCount: 1,
    });
  });

  it("keeps kiosk diagnostics admin-only without changing booking visibility", () => {
    const projection = {
      version: 1 as const,
      revision: 1,
      generatedAt: now.toISOString(),
      stats: { checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 },
      pendingPickupTotal: 0,
      openBookings: [],
      bookingActivity: [],
      kioskDevices: [{ id: "kiosk-1" }] as never,
    };

    expect(projectionForRole(projection, "ADMIN").kioskAccess).toBe("available");
    expect(projectionForRole(projection, "STAFF")).toMatchObject({
      kioskAccess: "restricted",
      kioskDevices: [],
    });
  });

  it("publishes only after successful operational mutations", () => {
    const response = new Response(null, { status: 200 });
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/bookings/1", { method: "PATCH" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/reservations", { method: "POST" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/reservations/1", { method: "DELETE" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/reservations-archive", { method: "POST" }),
      response,
    )).toBe(false);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/profile", { method: "PATCH" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/me/profile", { method: "PUT" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/locations/loc-1", { method: "PATCH" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/kiosk/heartbeat", { method: "POST" }),
      response,
    )).toBe(false);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/kiosk/activate", { method: "POST" }),
      response,
    )).toBe(true);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/bookings/1"),
      response,
    )).toBe(false);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/items/1", { method: "PATCH" }),
      response,
    )).toBe(false);
    expect(shouldPublishCompanionProjection(
      new Request("https://wisconsincreative.com/api/bookings/1", { method: "PATCH" }),
      new Response(null, { status: 409 }),
    )).toBe(false);
  });
});
