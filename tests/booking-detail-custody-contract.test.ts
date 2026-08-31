import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getBookingCancelCopy } from "@/hooks/booking-action-copy";

function sourceFor(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("booking detail custody contracts", () => {
  it("keeps web return controls out of the desktop booking page and equipment tab", () => {
    const detailSource = sourceFor("src/app/(app)/bookings/BookingDetailPage.tsx");
    const equipmentSource = sourceFor("src/app/(app)/bookings/BookingEquipmentTab.tsx");
    const actionSource = sourceFor("src/hooks/useBookingActions.ts");

    expect(detailSource).not.toContain("onCheckinBulk={actions.checkinBulk}");
    expect(detailSource).not.toContain("actions.completeCheckin");
    expect(equipmentSource).not.toContain("onCheckinBulk");
    expect(equipmentSource).not.toContain("Return All");
    expect(actionSource).not.toContain("/checkin-items");
    expect(actionSource).not.toContain("/checkin-bulk");
    expect(actionSource).not.toContain("/complete-checkin");
    expect(actionSource).toContain("/force-complete");
    expect(detailSource).toContain("Close without scan");
  });

  it("keeps reservation-to-checkout conversion out of web detail surfaces", () => {
    const detailSource = sourceFor("src/app/(app)/bookings/BookingDetailPage.tsx");
    const sheetSource = sourceFor("src/components/BookingDetailsSheet.tsx");
    const actionSource = sourceFor("src/hooks/useBookingActions.ts");

    expect(detailSource).not.toContain("actions.convert");
    expect(detailSource).not.toContain("Start checkout");
    expect(sheetSource).not.toContain("/api/reservations/${booking.id}/convert");
    expect(sheetSource).not.toContain("Start checkout");
    expect(actionSource).not.toContain("/api/reservations/${bookingId}/convert");
    expect(actionSource).toContain("/api/reservations/${bookingId}/force-checkout");
    expect(detailSource).toContain("Force checkout reservation?");
    expect(detailSource).toContain('allowedActions.includes("force-checkout")');
  });

  it("names cancellation as an irreversible release of equipment commitments", () => {
    expect(getBookingCancelCopy("CHECKOUT", "Camera pickup")).toEqual({
      title: "Cancel checkout?",
      message: 'Cancel "Camera pickup" and release its equipment commitments. The record stays in history, and the checkout cannot be reopened.',
      confirmLabel: "Cancel checkout",
      success: "Checkout cancelled",
    });
  });
});
