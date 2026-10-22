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
    const derivation = source.slice(
      source.indexOf("func isWaitingOnPickup"),
      source.indexOf("private struct BookingListSection"),
    );

    expect(derivation).toContain("kind == .reservation");
    expect(derivation).toContain("status == .booked");
    expect(derivation).toContain("startsAt < now");
    expect(derivation).not.toMatch(/\bstatus\s=(?!=)/);
  });

  it("refreshes the whole row presentation on the existing minute cadence", () => {
    const body = row.slice(row.indexOf("var body: some View"), row.indexOf("private var metadata"));

    expect(body).toContain("TimelineView(.periodic(from: .now, by: 60))");
    expect(body).toContain("timing(now: now)");
    expect(body).toContain("rowAccessibilityLabel(now: now)");
  });

  it("groups missed pickups under their own heading with missed-pickup wording, without mutating lifecycle state", () => {
    expect(source).toContain('title: "Waiting on pickup"');
    expect(row).toContain('return ("Pickup was due \\(when(booking.startsAt, now: now))", false)');
    expect(row).toContain('parts.append("Waiting on pickup")');
    expect(row).toContain("parts.append(timing(now: now).text)");
    expect(row).not.toContain('StatusPill(label: "Pending Pickup"');
  });
});
