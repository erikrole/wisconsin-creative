import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookings = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
const detail = readFileSync("ios/Wisconsin/Views/BookingDetailView.swift", "utf8");
const create = readFileSync("ios/Wisconsin/Views/CreateBookingSheet.swift", "utf8");
const api = readFileSync("ios/Wisconsin/Core/APIClient.swift", "utf8");

describe("iOS booking list actions", () => {
  it("offers state-aware native row actions", () => {
    expect(bookings).toContain(".contextMenu {");
    expect(bookings).toContain('Label("Edit Booking", systemImage: "pencil")');
    expect(bookings).toContain('Label("Transfer Ownership", systemImage: "person.2")');
    expect(bookings).toContain('Label("Extend Return", systemImage: "clock.arrow.circlepath")');
    expect(bookings).toContain('Label("Cancel Reservation", systemImage: "xmark.circle")');
    expect(bookings).toContain("booking.kind == .checkout && canExtend(booking)");
    expect(bookings).toContain("booking.kind == .reservation");
  });

  it("does not show search before or for a short loaded list", () => {
    expect(bookings).toContain("private var showsSearch: Bool");
    expect(bookings).toContain("if !vm.searchText.isEmpty { return true }");
    expect(bookings).toContain("!vm.isLoading && visibleCount > 0");
    expect(bookings).toContain("visibleCount > 4 || vm.hasMore");
    expect(bookings).toContain("BookingsSearchModifier(isVisible: showsSearch");
  });
});

describe("iOS focused booking edit and transfer", () => {
  it("reuses reservation gear only into a different event context", () => {
    const viewModel = readFileSync("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift", "utf8");

    expect(detail).toContain('booking.allows("duplicate") == true');
    expect(detail).toContain('Label("Reuse Gear for Another Event"');
    expect(detail).toContain("composer.prefillGearForNewEvent(from: booking)");
    expect(viewModel).toContain("func prefillGearForNewEvent(from booking: Booking)");
    expect(viewModel).toContain("reusedGearSourceEventIds = Set(booking.linkedEvents.map(\\.id))");
    expect(viewModel).toContain("selectedAssetIds = Set(booking.serializedItems.map(\\.assetId))");
    expect(viewModel).toContain("hasInvalidReusedEventSelection");
    expect(create).toContain("!vm.isReusingGear || (setupMode == .event && vm.linkedEventCount > 0)");
    expect(create).toContain("if canLinkEvents && !vm.isReusingGear");
    expect(create).toContain('Label("Choose a different event when reusing gear"');
  });

  it("only edits the booking name and return time", () => {
    const editor = detail.slice(
      detail.indexOf("struct EditBookingSheet"),
      detail.indexOf("struct TransferBookingOwnerSheet"),
    );
    expect(editor).toContain('BrandSectionHeader("Booking Name")');
    expect(editor).toContain('DatePicker(\n                                    "Return Time"');
    expect(editor).toContain("APIClient.shared.bookingAvailability");
    expect(editor).toContain('Label("This return time works"');
    expect(editor).toContain('Text("Transfer Ownership")');
    expect(editor).not.toContain("TextEditor(");
    expect(editor).not.toContain("OptionPickerView(");
    expect(editor).not.toContain('DatePicker("From"');
  });

  it("uses the existing optimistic-lock and complete-equipment contracts", () => {
    expect(api).toContain("func transferBookingOwner(id: String, targetUserId: String, updatedAt: Date?)");
    expect(api).toContain('forHTTPHeaderField: "X-Booking-Updated-At"');
    expect(api).not.toContain("If-Unmodified-Since");
    expect(api).toContain('request(path: "/api/bookings/\\(id)/transfer-owner", method: "POST")');
    expect(api).toContain("func bookingAvailability(for booking: Booking, endsAt: Date)");
    expect(api).toContain("serializedAssetIds: booking.serializedItems.map(\\.assetId)");
    expect(api).toContain("booking.bulkItems.map");
    expect(api).toContain("excludeBookingId: booking.id");
    expect(api).toContain("kind: booking.kind.rawValue");
  });
});

describe("iOS reservation setup refresh", () => {
  it("uses a visible three-step progression and bottom primary action", () => {
    expect(create).toContain("ReservationStepProgress(currentStep: step)");
    expect(create).toContain('private let labels = ["Details", "Gear", "Review"]');
    expect(create).toContain(".safeAreaInset(edge: .bottom, spacing: 0)");
    expect(create).toContain('Label("Choose Gear", systemImage: "shippingbox")');
    expect(create).toContain('BrandSectionHeader("Set Schedule From")');
    expect(create).toContain('BrandSectionHeader("Pickup Location")');
    expect(create).toContain('BrandSectionHeader("When")');
    expect(create).toContain('Text("Create Reservation")');
    expect(create).toContain("UserAvatarView(");
    expect(create).toContain(".tint(Color.statusText(.purple))");
    expect(create).not.toContain('Text("Status: Reserved")');
  });
});
