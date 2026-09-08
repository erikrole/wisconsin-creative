import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS booking pending-pickup row", () => {
  const source = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
  const viewModel = source.slice(
    source.indexOf("final class BookingsViewModel"),
    source.indexOf("struct BookingsView: View"),
  );
  const row = source.slice(source.indexOf("struct BookingRow: View"));

  it("orders reservations by pickup time and checkouts by due-back time", () => {
    expect(viewModel).toContain(
      "booking.kind == .reservation ? booking.startsAt : booking.endsAt",
    );
    expect(viewModel).toContain(
      "sortedBookings = bookings.sorted(by: Self.operationalTimeSort)",
    );
  });

  it("derives Pending Pickup only for booked reservations after startsAt", () => {
    const derivation = row.slice(
      row.indexOf("private func isPendingPickup"),
      row.indexOf("private var itemCount"),
    );

    expect(derivation).toContain("booking.kind == .reservation");
    expect(derivation).toContain("booking.status == .booked");
    expect(derivation).toContain("booking.startsAt < now");
    expect(derivation).not.toMatch(/booking\.status\s=(?!=)/);
  });

  it("refreshes the whole row presentation on the existing minute cadence", () => {
    const body = row.slice(
      row.indexOf("var body: some View"),
      row.indexOf("private func compactRow"),
    );

    expect(body).toContain("TimelineView(.periodic(from: .now, by: 60))");
    expect(body).toContain("compactRow(now: context.date)");
    expect(body).toContain("accessibilityRow(now: context.date)");
    expect(body).toContain("rowAccessibilityLabel(now: context.date)");
  });

  it("uses an orange rail and missed-pickup wording without mutating lifecycle state", () => {
    expect(row).toContain("if isPendingPickup(now: now) { return .orange }");
    expect(row).toContain(
      'return ("Pickup was due \\(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))", false)',
    );
    expect(row).toContain('parts.append("Pending pickup")');
    expect(row).toContain("parts.append(timing(now: now).text)");
    expect(row).not.toContain('StatusPill(label: "Pending Pickup"');
  });
});
