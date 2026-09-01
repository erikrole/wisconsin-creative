import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("native booking extend concurrency contract", () => {
  it("sends the visible booking snapshot and decodes the authoritative response", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const extendMethod = apiClient.slice(
      apiClient.indexOf("func extendBooking("),
      apiClient.indexOf("func createReservation("),
    );

    expect(extendMethod).toContain("updatedAt: Date?");
    expect(extendMethod).toContain('Refresh this booking before extending it.');
    expect(extendMethod).toContain('forHTTPHeaderField: "X-Booking-Updated-At"');
    expect(extendMethod).toContain("bookingSnapshotString(updatedAt)");
    expect(extendMethod).not.toContain("If-Unmodified-Since");
    expect(extendMethod).toContain("let response: DataWrapper<Booking> = try await perform(req)");
    expect(extendMethod).toContain("return response.data");
    expect(extendMethod).not.toContain("authenticatedData(for: req)");
  });

  it("passes the source booking through the sheet and installs the returned snapshot", () => {
    const sheet = source("ios/Wisconsin/Views/ExtendBookingSheet.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const list = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(sheet).toContain("let booking: Booking");
    expect(sheet).toContain("let onSuccess: (Booking) -> Void");
    expect(sheet).toContain("updatedAt: booking.updatedAt");
    expect(sheet).toContain("onSuccess(updatedBooking)");
    expect(detail).toContain("install(updatedBooking)");
    expect(detail).toContain("booking = updatedBooking");
    expect(list).toContain("vm.install(updatedBooking)");
    expect(list).toContain("bookings = bookings.map { $0.id == booking.id ? booking : $0 }");
    expect(sheet).not.toContain("bookingId: String");
  });
});
