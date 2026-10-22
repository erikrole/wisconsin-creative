import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS booking surface alignment", () => {
  const bookings = readFileSync("ios/Wisconsin/Views/BookingsView.swift", "utf8");
  const itemDetail = readFileSync("ios/Wisconsin/Views/ItemDetailView.swift", "utf8");
  const bookingRow = bookings.slice(
    bookings.indexOf("struct BookingRow: View"),
    bookings.indexOf("struct StatusBadge: View"),
  );

  it("reads title, then timing, then requester, with no location or gear on the row", () => {
    expect(bookingRow.indexOf("Text(booking.title)")).toBeLessThan(bookingRow.indexOf("Text(info.text)"));
    expect(bookingRow.indexOf("Text(info.text)")).toBeLessThan(bookingRow.indexOf("Text(booking.requester.name)"));
    expect(bookingRow).not.toContain("booking.location.name");
    expect(bookingRow).not.toContain("gearSummary");

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

  it("keeps the row quiet: requester avatar and a status-coloured timing line, no rail, badge, or card chrome", () => {
    expect(bookingRow).not.toContain("StatusRail");
    expect(bookingRow).not.toContain("StatusBadge");
    expect(bookingRow).toContain("UserAvatarView(name: booking.requester.name, avatarUrl: booking.requester.avatarUrl");
    expect(bookingRow).not.toContain(".shadow(");
    expect(bookingRow).toContain("capitalizesRelativeDay: false");
    expect(bookingRow).toContain("Color.statusText(tone(now: now))");
    expect(bookingRow).toContain("if booking.isOverdue(now: now) { return .red }");
    expect(bookingRow).not.toContain("compactMagnitude(now:");
  });

  it("keeps timing typographic instead of repeating status icons", () => {
    const timing = bookingRow.slice(
      bookingRow.indexOf("private func timing"),
      bookingRow.indexOf("private func rowAccessibilityLabel"),
    );
    expect(timing).not.toContain("Label {");
    expect(timing).not.toContain("Image(systemName:");
  });

  it("keeps orange for missed pickups only", () => {
    expect(bookingRow).toContain("case .pendingPickup: return booking.startsAt < now ? .orange : .purple");
  });

  it("names the booking that needs the gear next on detail", () => {
    const detail = readFileSync("ios/Wisconsin/Views/BookingDetailView.swift", "utf8");
    const api = readFileSync("ios/Wisconsin/Core/APIClient.swift", "utf8");
    expect(api).toContain("nextNeedTitle: next?.bookingTitle?.nonBlankText");
    expect(detail).toContain("if let title = returnInsight.nextNeedTitle");
    expect(detail).toContain('return "\\(title) needs this gear \\(when). Extend only to a return time by then."');
    // Relative day, never the full year.
    expect(detail).toContain("nextNeedAt.operationalDateTimeLabel(now: today, capitalizesRelativeDay: false)");
    expect(detail).not.toContain("nextNeedAt.gearShort");
  });
});
