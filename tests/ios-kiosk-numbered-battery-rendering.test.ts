import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sectionBetween(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

describe("iOS kiosk numbered-battery rendering", () => {
  it("avoids the async-renderer actor trap while preserving exact unit tags", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const chips = sectionBetween(
      components,
      "struct KioskUnitChips: View",
      "// MARK: Error state",
    );

    // The iPadOS 26 crash entered chipContent from SwiftUI.AsyncRenderer while
    // ViewThatFits was evaluating a deferred ForEach candidate. Keep this
    // boundary as one wrapping text value with no reusable ViewBuilder closure.
    expect(chips).not.toContain("ViewThatFits");
    expect(chips).not.toContain("ForEach(");
    expect(chips).not.toContain("@ViewBuilder");
    expect(chips).not.toContain("chipContent");
    expect(chips).toContain("units.map(\\.tag).joined");
    expect(chips).toContain('Text(unitSummary)');
    expect(chips).toContain(".fixedSize(horizontal: false, vertical: true)");
  });

  it("keeps the safe unit summary wired into pickup and return", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const kioskReturn = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");

    expect(components).toContain("KioskUnitChips(units: scannedUnits)");
    for (const flow of [pickup, kioskReturn]) {
      expect(flow).toContain("KioskBatteryScanStatus(");
      expect(flow).toContain("scannedUnits:");
    }
  });
});
