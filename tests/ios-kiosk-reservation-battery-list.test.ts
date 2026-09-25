import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk reservation battery checklist", () => {
  it("presents numbered reservation batteries as a quantity while retaining physical unit scans", () => {
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const fixture = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");

    expect(pickup).toContain("private var checklistEntries: [KioskPickupChecklistEntry]");
    expect(pickup).toContain("guard item.isNumberedBulk else");
    expect(pickup).toContain("case .battery(let group)");
    expect(pickup).toContain("KioskPickupBatteryChecklistRow(");
    expect(pickup).toContain("printed numbers don't need to match the list.");
    expect(pickup).toContain("confirmedItemOverrides[item.id]");
    expect(pickup).toContain("let targetId = checklistScrollTarget(for: newId)");

    expect(fixture).toContain('case reservationBatteryPickup = "reservation-battery-pickup"');
    expect(fixture).toContain('kioskStore.screen = .pickup(bookingId: "rs-1", userId: kioskUser.id)');
    expect(fixture).toContain("return reservationBatteryPickupDetailJSON(id: id)");
    expect(fixture).toContain('"numberedBulkTotal":10');
    expect(fixture).toContain('"type":"numbered_bulk"');
  });
});
