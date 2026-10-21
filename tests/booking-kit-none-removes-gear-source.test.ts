import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("choosing no kit removes only the kit's gear", () => {
  it("web wizard tracks kit-added gear and removes it on None", () => {
    const wizard = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");
    expect(wizard).toContain("kitAddedAssetIdsRef");
    expect(wizard).toContain("kitAddedBulkIdsRef");
    expect(wizard).toContain("!addedAssets.has(asset.id)");
  });

  it("iOS booking model removes kit gear on None and location change", () => {
    const vm = readFileSync("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift", "utf8");
    expect(vm).toContain("private func removeKitGear()");
    expect(vm.match(/removeKitGear\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
