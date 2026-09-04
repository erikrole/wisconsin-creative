import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterSupportedReservationPickupLocations,
  isSupportedReservationPickupLocation,
  isSupportedReservationPickupLocationName,
} from "@/lib/reservation-pickup-locations";

describe("reservation pickup locations", () => {
  it("allows only the two current pickup counters and the canonical Camp Randall name", () => {
    expect(isSupportedReservationPickupLocationName("Camp Randall")).toBe(true);
    expect(isSupportedReservationPickupLocationName("Camp Randall Stadium")).toBe(true);
    expect(isSupportedReservationPickupLocationName(" Kohl  Center ")).toBe(true);
    expect(isSupportedReservationPickupLocationName("UW Field House")).toBe(false);
    expect(isSupportedReservationPickupLocationName("Camp Randall Creative Desk")).toBe(false);
  });

  it("requires an active supported location record", () => {
    expect(isSupportedReservationPickupLocation({ active: true, name: "Kohl Center" })).toBe(true);
    expect(isSupportedReservationPickupLocation({ active: false, name: "Kohl Center" })).toBe(false);
    expect(isSupportedReservationPickupLocation(null)).toBe(false);
  });

  it("filters reservation controls without narrowing the shared location catalog", () => {
    const locations = [
      { id: "camp", name: "Camp Randall Stadium" },
      { id: "field", name: "UW Field House" },
      { id: "kohl", name: "Kohl Center" },
    ];

    expect(filterSupportedReservationPickupLocations(locations)).toEqual([
      locations[0],
      locations[2],
    ]);
  });
});

describe("reservation pickup wiring", () => {
  it("uses the allowlist in web reservation surfaces and keeps event venues separate", () => {
    const wizard = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");
    const list = readFileSync("src/components/BookingListPage.tsx", "utf8");
    const step = readFileSync("src/components/booking-wizard/WizardStep1.tsx", "utf8");
    const eventContext = readFileSync("src/components/create-booking/use-event-context.ts", "utf8");

    expect(wizard).toContain("filterSupportedReservationPickupLocations");
    expect(list).toContain("filterSupportedReservationPickupLocations");
    expect(list).toContain("pickupLocations.map");
    expect(step).toContain('<Field label="Pickup location"');
    expect(eventContext).not.toContain("locationId: primary.location?.id");
  });
});
