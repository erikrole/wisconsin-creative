import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS SwiftUI performance contracts", () => {
  it("derives booking and schedule indexes when source data changes", () => {
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(bookings).toContain("didSet {\n            sortedBookings = bookings.sorted");
    expect(bookings).toContain("private(set) var sortedBookings: [Booking] = []");

    expect(schedule).toContain("didSet { rebuildEventIndexes() }");
    expect(schedule).toContain("private(set) var groupedEvents:");
    expect(schedule).toContain("private(set) var eventsByDay:");
    expect(schedule).toContain("private func rebuildEventIndexes()");
    expect(schedule).toContain("eventList(groups: groups)");

    expect(eventDetail).toContain("didSet { shiftsByArea = Self.makeShiftsByArea");
    expect(eventDetail).toContain("private(set) var shiftsByArea:");
  });

  it("evaluates reservation picker collections once per render pass", () => {
    const picker = source(
      "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift",
    );

    expect(picker).toContain("let displayedAssetGroups = vm.displayedAssetGroups");
    expect(picker).toContain("let displayedBulkSkus = vm.displayedBulkSkus");
    expect(picker).toContain("let displayedCategoryResults = vm.displayedCategoryResults");
    expect(picker).toContain("ForEach(displayedAssetGroups)");
    expect(picker).toContain("ForEach(displayedBulkSkus)");
    expect(picker).not.toContain("ForEach(vm.displayedAssetGroups)");
    expect(picker).not.toContain("ForEach(vm.displayedBulkSkus)");
  });

  it("classifies Trade Board rows in one pass without nested membership scans", () => {
    const tradeBoard = source(
      "ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift",
    );

    expect(tradeBoard).toContain("private func rebuildSections()");
    expect(tradeBoard).toContain("for trade in trades");
    expect(tradeBoard).not.toContain(
      "availableTrades.contains(where: { $0.id == trade.id })",
    );
    expect(tradeBoard).not.toContain(
      "myTrades.contains(where: { $0.id == trade.id })",
    );
    expect(tradeBoard).not.toContain(
      "resolvedTrades.contains(where: { $0.id == trade.id })",
    );
  });

  it("builds the Home action queue once for row and divider rendering", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");

    expect(home).toContain("private func makeDisplayedEntries()");
    expect(home).toContain("let entries = makeDisplayedEntries()");
    expect(home).toContain("ForEach(Array(entries.enumerated())");
    expect(home).not.toContain("displayedEntries.last?.id");
  });

  it("keeps performance instrumentation on stable pre-iOS-27 APIs", () => {
    const instrumentation = source(
      "ios/Wisconsin/Core/PerformanceInstrumentation.swift",
    );
    const harness = source(
      "ios/Wisconsin/App/PerformanceTestHarness.swift",
    );

    expect(instrumentation).toContain("OSSignposter(");
    expect(instrumentation).toContain("MXMetricManager.shared.add(self)");
    expect(instrumentation).not.toMatch(/\bMetricManager\b/);
    expect(instrumentation).not.toContain("iOS 27");
    expect(instrumentation).not.toContain("#available(iOS 27");
    expect(harness).toContain("#if DEBUG");
  });
});
