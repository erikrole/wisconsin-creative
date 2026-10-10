import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS booking surface alignment", () => {
  const bookings = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
  const itemDetail = readFileSync("ios/Wisconsin/Views/ItemDetailView.swift", "utf8");
  const bookingRow = bookings.slice(bookings.indexOf("struct BookingRow: View"));

  it("reads title, then requester, with the handoff time trailing like Schedule", () => {
    const compact = bookingRow.slice(
      bookingRow.indexOf("private func compactRow"),
      bookingRow.indexOf("private func accessibilityRow"),
    );
    expect(compact.indexOf("bookingTitle.lineLimit(2)")).toBeLessThan(
      compact.indexOf("metadataLine(now: now, lineLimit: 1)"),
    );
    expect(compact.indexOf("metadataLine(now: now, lineLimit: 1)")).toBeLessThan(
      compact.indexOf("timeColumn(now: now)"),
    );
    expect(bookingRow).toContain("Text(booking.requester.name)");

    const activeItemCard = itemDetail.slice(
      itemDetail.indexOf("private struct ActiveBookingCard"),
      itemDetail.indexOf("// MARK: - Availability card"),
    );
    expect(activeItemCard.indexOf("TimelineView(")).toBeLessThan(
      activeItemCard.indexOf("Text(booking.title)"),
    );
    expect(activeItemCard.indexOf("Text(booking.title)")).toBeLessThan(
      activeItemCard.indexOf("Text(timing(now: context.date))"),
    );
    expect(activeItemCard.indexOf("Text(timing(now: context.date))")).toBeLessThan(
      activeItemCard.indexOf("Text(booking.requesterName)"),
    );
  });

  it("lets the time column's tone carry active checkout urgency without a duplicate badge", () => {
    // Open checkouts (blue "Due") and booked rows (purple "Pickup") are
    // already self-describing, so neither spends a status word.
    expect(bookingRow).toContain("case .open: booking.kind != .checkout");
    expect(bookingRow).toContain("case .booked: false");
    expect(bookingRow).toContain("if showsStatusBadge");
    expect(bookingRow).toContain(".foregroundStyle(Color.statusText(accentTone(now: now)))");
    // The rail stays as the row's one state mark; the card shadow and
    // chevron do not.
    expect(bookingRow).toContain("StatusRail(tone: accentTone(now: now))");
    expect(bookingRow).not.toContain(".shadow(");
    expect(bookingRow).not.toContain("chevron.right");
    expect(bookingRow).toContain("capitalizesRelativeDay: false");
    expect(bookingRow).not.toContain("compactMagnitude(now:");
  });

  it("keeps timing typographic instead of repeating status icons", () => {
    const timeColumn = bookingRow.slice(
      bookingRow.indexOf("private func timeColumn"),
      bookingRow.indexOf("private func timing("),
    );
    expect(timeColumn).toContain("Text(primaryTime(now: now))");
    expect(timeColumn).toContain("Text(actionWord(now: now))");
    expect(timeColumn).not.toContain("Label {");
    expect(timeColumn).not.toContain("Image(systemName:");
  });
});
