import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const header = readFileSync("src/components/booking-details/BookingHeader.tsx", "utf8");
const detail = readFileSync("src/app/(app)/bookings/BookingDetailPage.tsx", "utf8");

describe("web booking detail iOS alignment", () => {
  it("keeps the shared detail header identity and operational summary first", () => {
    expect(header).toContain('aria-label="Booking summary"');
    expect(header).toContain("booking.requester?.name");
    expect(header).toContain('label="Pickup location"');
    expect(header).toContain('label="Gear"');
    expect(header).toContain('label: "Due back"');
    expect(header).toContain('label: "Pickup"');
    expect(header).toContain("eventLabel");
  });

  it("retains web operator actions, freshness, equipment, and history", () => {
    expect(header).toContain("Nudge borrower");
    expect(header).toContain("Close without scan");
    expect(header).toContain("Transfer owner");
    expect(header).toContain("Edit linked events");
    expect(header).toContain("syncStatus");
    expect(detail).toContain("<BookingEquipmentTab booking={booking} onBookingUpdated={patchLocal} />");
    expect(detail).toContain("<BookingInfoCard");
    expect(detail).toContain("<BookingHistoryTab");
  });

  it("keeps kiosk handoff language visible without adding web custody controls", () => {
    expect(detail).toContain('"Pickup at kiosk"');
    expect(detail).toContain('"Return at kiosk"');
    expect(detail).toContain('"Pick up at kiosk"');
    expect(detail).not.toContain("actions.completeCheckin");
    expect(detail).not.toContain("actions.convert");
  });
});
