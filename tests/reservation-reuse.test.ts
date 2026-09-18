import { describe, expect, it } from "vitest";
import { isEventDerivedTitle, mergeReuseEquipment } from "@/lib/reservation-reuse";
import { deriveReusedReservationWindow } from "@/components/create-booking/use-event-context";
import { getAllowedBookingActions } from "@/lib/booking-action-policy";
import { toLocalDateTimeValue, type CalendarEvent } from "@/components/booking-list/types";

const camera = {
  id: "asset-1",
  assetTag: "FX3-1",
  name: "FX3 1",
  brand: "Sony",
  model: "FX3",
  serialNumber: "1",
  type: "Camera",
  computedStatus: "AVAILABLE",
  imageUrl: null,
  location: { id: "loc-1", name: "Camp Randall" },
};

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-iowa",
    summary: "Football vs Iowa",
    startsAt: "2026-09-06T17:00:00.000Z",
    endsAt: "2026-09-06T20:00:00.000Z",
    allDay: false,
    sportCode: "FB",
    isHome: true,
    opponent: "Iowa",
    rawLocationText: null,
    location: null,
    ...overrides,
  };
}

describe("reservation reuse equipment", () => {
  it("rebuilds a completed reservation from remaining lines plus linked checkout gear", () => {
    const merged = mergeReuseEquipment(
      {
        serializedItems: [],
        bulkItems: [{ bulkSkuId: "sku-sony", plannedQuantity: 2, bulkSku: { id: "sku-sony", name: "Sony Battery" } }],
      },
      [{
        serializedItems: [{ assetId: "asset-1", asset: camera }],
        bulkItems: [{ bulkSkuId: "sku-sony", plannedQuantity: 4, bulkSku: { id: "sku-sony", name: "Sony Battery" } }],
      }],
    );

    expect(merged.serializedItems.map((item) => item.assetId)).toEqual(["asset-1"]);
    expect(merged.bulkItems).toEqual([
      { bulkSkuId: "sku-sony", plannedQuantity: 6, bulkSku: { id: "sku-sony", name: "Sony Battery" } },
    ]);
  });
});

describe("reservation reuse titles and windows", () => {
  it("keeps kit names and copies the source pickup offset onto the new event", () => {
    const nextGame = event({
      id: "evt-minnesota",
      summary: "Football vs Minnesota",
      startsAt: "2026-09-13T17:00:00.000Z",
      endsAt: "2026-09-13T20:00:00.000Z",
      opponent: "Minnesota",
    });

    const derived = deriveReusedReservationWindow({
      targetEvents: [nextGame],
      sourceEvents: [event()],
      sourceStartsAt: "2026-09-06T15:00:00.000Z",
      sourceEndsAt: "2026-09-06T22:00:00.000Z",
      sourceTitle: "Slow 1",
      sport: "FB",
    });

    expect(derived.title).toBe("Slow 1");
    expect(derived.startsAt).toBe(toLocalDateTimeValue(new Date("2026-09-13T15:00:00.000Z")));
    expect(derived.endsAt).toBe(toLocalDateTimeValue(new Date("2026-09-13T22:00:00.000Z")));
  });

  it("treats generated event titles as replaceable", () => {
    expect(isEventDerivedTitle("FB vs Iowa", [event()], "FB vs Iowa")).toBe(true);
    expect(isEventDerivedTitle("Slow 1", [event()], "FB vs Iowa")).toBe(false);
  });
});

describe("re-reserve action policy", () => {
  const staff = { id: "staff-1", role: "STAFF" };
  const owner = { id: "student-1", role: "STUDENT" };

  it("lets staff or the owner re-reserve a completed checkout into a new reservation", () => {
    const completedCheckout = {
      kind: "CHECKOUT" as const,
      status: "COMPLETED",
      requesterUserId: "student-1",
      createdBy: "staff-1",
    };

    expect(getAllowedBookingActions(staff, completedCheckout, "CHECKOUT")).toContain("duplicate");
    expect(getAllowedBookingActions(owner, completedCheckout, "CHECKOUT")).toContain("duplicate");
    expect(getAllowedBookingActions(
      { id: "other-student", role: "STUDENT" },
      completedCheckout,
      "CHECKOUT",
    )).not.toContain("duplicate");
  });
});
