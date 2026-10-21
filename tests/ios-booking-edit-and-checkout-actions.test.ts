import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync("ios/Wisconsin/Views/BookingDetailView.swift", "utf8");
const bookings = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
const reservationEdit = readFileSync("ios/Wisconsin/Views/Booking/ReservationEditFlow.swift", "utf8");
const actionSheets = readFileSync("ios/Wisconsin/Views/Booking/BookingActionSheets.swift", "utf8");
const api = readFileSync("ios/Wisconsin/Core/APIClient.swift", "utf8");

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("iOS reservation edit", () => {
  it("keeps the checkout editor narrow and routes reservations to their own flow", () => {
    const checkoutEditor = sliceBetween(detail, "struct EditBookingSheet", "struct TransferBookingOwnerSheet");
    expect(checkoutEditor).toContain('TextField("Booking name"');
    expect(checkoutEditor).toContain('LabeledContent("Due back")');
    expect(checkoutEditor).toContain("ReturnTimeCalendar(");
    expect(checkoutEditor).not.toContain("ReservationEditFlow");
    expect(checkoutEditor).not.toContain("serializedAssetIds");

    const listSheet = bookings.slice(bookings.indexOf(".sheet(item: $presentedAction)"));
    expect(listSheet).toContain("if booking.kind == .reservation");
    expect(listSheet).toContain("ReservationEditFlow(booking: booking)");
    expect(listSheet).toContain("EditBookingSheet(booking: booking)");
    expect(listSheet.indexOf("ReservationEditFlow(booking: booking)")).toBeLessThan(
      listSheet.indexOf("EditBookingSheet(booking: booking)"),
    );

    expect(detail).toContain("showEdit = AppRuntimeMode.CaptureSeed.bookingEdit");
    expect(detail).toContain("if booking.kind == .reservation");
    expect(detail).toContain("showReservationEdit = true");
    expect(detail).toContain("showEdit = true");
  });

  it("saves one plan, then events, and blocks a failed availability check", () => {
    expect(reservationEdit).toContain('.navigationTitle("Edit Reservation")');
    expect(reservationEdit).toContain('Text(primaryTitle).fontWeight(.semibold)');
    expect(reservationEdit).toContain('return "Save changes"');
    expect(reservationEdit).toContain('return "Check availability"');
    expect(reservationEdit).toContain("ReservationGearEditor(lines: $lines, locationId: locationId)");
    expect(reservationEdit).toContain("BookingEventChooser(");
    expect(reservationEdit).toContain("APIClient.shared.updateReservation(");
    expect(reservationEdit).toContain("APIClient.shared.updateBookingEvents(");
    expect(reservationEdit).toContain("excludeBookingId: baseline.id");
    expect(reservationEdit).toContain("bookingKind: .reservation");
    expect(reservationEdit).toContain("filter(\\.isReservationPickupCounter)");
    expect(reservationEdit).toContain('allocationStatus?.lowercased() == "picked_up"');
    expect(reservationEdit).toContain("var canRemove: Bool { !isPickedUp && checkedOutQuantity == 0 }");
    expect(reservationEdit).toContain("if needsAvailability { return availability == .clear }");
    expect(reservationEdit).not.toContain("TextEditor(");
  });
});

describe("iOS checkout detail actions", () => {
  it("keeps Extend as the only bottom action and gathers the rest in one menu", () => {
    expect(detail).toContain('booking.allows("edit") ?? legacyCanEdit');
    expect(detail).toContain('booking.allows("extend") ?? legacyAllowed');
    expect(detail).toContain("if canExtendBooking");
    expect(detail).toContain("BookingExtendBar(");
    expect(detail).toContain("if canCancelBooking");
    expect(detail).toContain('.accessibilityLabel("Booking actions")');
    expect(detail).toContain('Label("Edit Details", systemImage: "pencil")');
    expect(detail).toContain('Label("Nudge borrower", systemImage: "bell")');
    expect(detail).toContain('Label("Close without scan", systemImage: "checkmark.shield")');
    expect(detail).toContain('Label("Force checkout", systemImage: "exclamationmark.arrow.triangle.2.circlepath")');
    expect(detail).toContain('Label("Close without remaining gear", systemImage: "archivebox")');
    expect(detail).toContain('Label("Transfer Ownership", systemImage: "person.2")');
    expect(detail).toContain('Label("Edit linked events", systemImage: "calendar")');
    expect(detail).toContain('Label("Re-reserve for Another Event"');
    expect(detail).toContain('booking?.allows("nudge") == true');
    expect(detail).toContain('booking?.allows("force-complete") == true');
    expect(detail).toContain('booking?.allows("force-checkout") == true');
    expect(detail).toContain('booking?.allows("close-remaining") == true && pickupHasStarted');
    expect(detail).toContain('booking?.allows("manage-custody") == true');
    expect(detail).not.toContain('Image(systemName: "pencil")');
  });

  it("uses the shared booking routes and the same validation bounds", () => {
    const mutations = sliceBetween(api, "func updateReservation(", "func createReservation(");
    expect(mutations).toContain('request(path: "/api/bookings/\\(id)", method: "PATCH")');
    expect(mutations).toContain('request(path: "/api/bookings/\\(id)/events", method: "POST")');
    expect(mutations).toContain('request(path: "/api/bookings/\\(id)/nudge", method: "POST")');
    expect(mutations).toContain('request(path: "/api/bookings/\\(id)/force-complete", method: "POST")');
    expect(mutations).toContain('request(path: "/api/bookings/\\(id)/custody-scope", method: "POST")');
    expect(mutations).toContain('request(path: "/api/reservations/\\(id)/force-checkout", method: "POST")');
    expect(mutations).toContain('request(path: "/api/reservations/\\(id)/close-remaining", method: "POST")');
    expect(mutations).toContain('forHTTPHeaderField: "X-Booking-Updated-At"');
    expect(mutations).not.toContain("If-Unmodified-Since");
    expect(mutations).toContain("DataWrapper<Booking>");
    expect(api).toContain('throw APIError.serverError("Reason must be at least 10 characters")');
    expect(api).toContain('throw APIError.serverError("A booking may link at most 5 events.")');
    expect(api).toContain('throw APIError.serverError("Duplicate bulk item")');
    expect(api).toContain('throw APIError.serverError("endsAt must be later than startsAt")');
    expect(actionSheets).toContain("Reason must be at least 10 characters");
    expect(actionSheets).toContain("A booking may link at most 5 events.");
    expect(actionSheets).toContain("includePast: false");
    expect(reservationEdit).not.toContain('method: "PATCH"');
  });
});
