import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Kiosk availability status contract", () => {
  it("carries blocking booking identity through the shared availability response", () => {
    const service = source("src/lib/services/availability.ts");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const scanRoute = source("src/app/api/kiosk/checkout/scan/route.ts");

    expect(service).toContain("conflictingBookingKind?: BookingKind");
    expect(service).toContain("conflictingBookingStatus?: BookingStatus");
    expect(service).toContain("conflictingBookingRequesterName?: string");
    expect(service).toContain("requester: { select: { name: true } }");
    expect(service).toContain("conflictingBookingKind: item.booking.kind");
    expect(service).toContain("conflictingBookingStatus: item.booking.status");
    expect(models).toContain("let conflictingBookingKind: String?");
    expect(models).toContain("let conflictingBookingStatus: String?");
    expect(models).toContain("let conflictingBookingRequesterName: String?");
    expect(scanRoute).toContain("formatAvailabilityDeadline");
    expect(scanRoute).toContain("has checked out the");
  });

  it("names reserved and checked-out conflicts in the Kiosk row and feedback", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const fixtures = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");

    expect(checkout).toContain("case .reserved: return \"Reserved\"");
    expect(checkout).toContain("case .checkedOut: return \"Checked Out\"");
    expect(checkout).toContain("has reserved the");
    expect(checkout).toContain("has checked out the");
    expect(checkout).toContain(".month(.abbreviated).day().hour().minute()");
    expect(checkout).toContain("KioskAvailabilityCopy.blockingTitle(for: result)");
    expect(checkout).toContain("let status = availabilityIssue.map");
    expect(fixtures).toContain("case availabilityConflicts = \"availability-conflicts\"");
    expect(fixtures).toContain("conflictingBookingKind: \"RESERVATION\"");
    expect(fixtures).toContain("conflictingBookingStatus: \"OPEN\"");
  });
});
