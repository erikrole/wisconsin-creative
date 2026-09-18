import { describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  booking: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

import { getBookingReusePlan } from "@/lib/services/booking-reuse";

function asset(id: string) {
  return {
    id,
    assetTag: `TAG-${id}`,
    name: id,
    brand: "Sony",
    model: "FX3",
    serialNumber: id,
    type: "Camera",
    imageUrl: null,
    qrCodeValue: `qr-${id}`,
    location: { id: "loc-1", name: "Camp Randall" },
    category: { name: "Cameras" },
  };
}

describe("getBookingReusePlan", () => {
  it("includes handed-over checkout cameras on a completed reservation", async () => {
    dbMock.booking.findUnique.mockResolvedValue({
      id: "res-1",
      kind: BookingKind.RESERVATION,
      title: "Slow 1",
      notes: "Gameday",
      requesterUserId: "user-1",
      custodyScope: BookingCustodyScope.PERSON,
      locationId: "loc-1",
      kitId: "kit-1",
      sportCode: "FB",
      startsAt: new Date("2026-09-06T15:00:00.000Z"),
      endsAt: new Date("2026-09-06T22:00:00.000Z"),
      requester: { name: "Alex Photographer" },
      kit: { id: "kit-1", name: "Slow 1" },
      serializedItems: [],
      bulkItems: [],
      events: [{
        event: {
          id: "evt-iowa",
          summary: "Football vs Iowa",
          startsAt: new Date("2026-09-06T17:00:00.000Z"),
          endsAt: new Date("2026-09-06T20:00:00.000Z"),
          allDay: false,
          sportCode: "FB",
          opponent: "Iowa",
          isHome: true,
        },
      }],
      derivedCheckouts: [{
        serializedItems: [{ assetId: "asset-1", asset: asset("asset-1") }],
        bulkItems: [{
          bulkSkuId: "sku-1",
          plannedQuantity: 4,
          bulkSku: { id: "sku-1", name: "Sony Battery" },
        }],
      }],
    });

    const plan = await getBookingReusePlan("res-1");

    expect(plan.keepTitle).toBe(true);
    expect(plan.serializedItems.map((item) => item.assetId)).toEqual(["asset-1"]);
    expect(plan.bulkItems[0]?.plannedQuantity).toBe(4);
    expect(plan.kitName).toBe("Slow 1");
  });
});
