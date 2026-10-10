import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
const dates = source("ios/Wisconsin/Core/DateFormats.swift");

describe("iOS Booking Detail Item Detail alignment", () => {
  it("uses the holder-led Item Detail header without status or internal reference chrome", () => {
    const header = sliceBetween(detail, "private struct BookingDetailsSection", "private struct BookingOverviewSection");
    const rail = header.indexOf("StatusRail(tone:");
    const avatar = header.indexOf("UserAvatarView(");
    const title = header.indexOf("Text(booking.title)");
    const timing = header.indexOf("Text(timingLabel(now:");

    expect(rail).toBeLessThan(avatar);
    expect(avatar).toBeLessThan(title);
    expect(title).toBeLessThan(timing);
    // The header speaks the list's state words: "Due back · in 3 hours".
    expect(header).toContain('return "Due back · in \\(label.dropFirst("DUE BACK IN ".count))"');
    expect(header).toContain('return "Overdue · by \\(label.dropFirst("OVERDUE BY ".count))"');
    expect(header).toContain('"Awaiting pickup · in \\(pickup.body)"');
    expect(header).toContain('"Pickup missed · \\(pickup.body) late"');
    expect(header).toContain("Text(requesterLine)");
    expect(header).not.toContain("StatusBadge(");
    expect(header).not.toContain("booking.refNumber");
  });

  it("pins Extend and Cancel together above the tab bar, Extend primary", () => {
    const bar = sliceBetween(detail, "private struct BookingActionBar", "// MARK: - Shared");
    expect(detail).toContain(".safeAreaInset(edge: .bottom, spacing: 0)");
    expect(detail).toContain("if canExtendBooking || canCancelBooking");
    expect(detail).toContain("onExtend: canExtendBooking ? { showExtend = true } : nil");
    expect(detail).toContain("onCancel: canCancelBooking ? { showCancelConfirm = true } : nil");
    expect(bar).toContain(".background(.ultraThinMaterial)");
    expect(bar).toMatch(/Label\("Extend Return Date"[\s\S]*?\.buttonStyle\(\.borderedProminent\)/);
    expect(bar).toMatch(/Button\(role: \.destructive[\s\S]*?\.buttonStyle\(\.bordered\)/);
    expect(bar).toContain('onExtend == nil ? "Cancel Booking" : "Cancel"');
    // Cancel still asks first.
    expect(detail).toContain('.confirmationDialog("Cancel Booking", isPresented: $showCancelConfirm');
  });

  it("keeps Extend available when later demand exists and explains the safe boundary", () => {
    const extendPolicy = sliceBetween(detail, "private var canExtendBooking", "private var canCancelBooking");
    expect(extendPolicy).toContain('booking.allows("extend") ?? legacyAllowed');
    expect(extendPolicy).not.toContain("returnInsight.hasUpcomingNeed");
    expect(detail).toContain("Extend only to a return time by then.");
    expect(detail).not.toContain("Extension unavailable.");
  });

  it("keeps operational details compact and removes duplicate identity and location", () => {
    const overview = sliceBetween(detail, "private struct BookingOverviewSection", "private struct EquipmentSection");

    expect(overview).toContain('BrandSectionHeader("Schedule")');
    expect(overview).not.toContain('title: "Requester"');
    expect(overview).not.toContain("UserAvatarView(");
    expect(overview).not.toContain("booking.requester.email");
    // Label-leading, value-trailing rows; no icon circles.
    expect(overview).toContain('overviewRow(title: "Pickup")');
    expect(overview).toContain('overviewRow(title: "Return")');
    expect(overview).not.toContain("Color.statusBackground(tone), in: Circle()");
    expect(overview).not.toContain('arrow.up.right');
    expect(overview).not.toContain('arrow.down.left');
    expect(overview).not.toContain('title: "Pickup Location"');
    // The kiosk row appears only once a kiosk is recorded.
    expect(overview).toContain("if let kiosk = booking.pickupKioskDevice");
    expect(overview).toContain('overviewRow(title: "Pickup Kiosk")');
    expect(overview).toContain("date.operationalDateTimeLabel(now: today)");
    expect(dates).toContain("let dayDistance = Calendar.current.dayOffset(of: self, from: now)");
    expect(dates).toContain('case 0: return "Today"');
    expect(dates).toContain("abs(dayDistance) < 7");
    expect(dates).toContain(".dateTime.weekday(.wide)");
    expect(dates).toContain(".dateTime.weekday(.abbreviated).month(.abbreviated).day()");
    expect(dates).toContain('parts.joined(separator: ", ")');
    expect(overview).not.toContain(".year(");
    expect(overview).not.toContain("gearLong");
    expect(overview).toContain(".font(.subheadline.weight(.medium))");
    expect(detail).not.toContain('"Recorded when gear is picked up"');
    expect(overview).toContain(".padding(.vertical, 9)");
    expect(detail).toContain('"Needed again soon. Choose an earlier return time when extending."');
  });

  it("keeps Gear clean and gives returned rows a non-color cue", () => {
    const gear = sliceBetween(detail, "private struct EquipmentSection", "private struct BookingActionBar");

    expect(gear).toContain('BrandSectionHeader(title: "Gear")');
    expect(gear).not.toContain("equipmentItemPill");
    expect(gear).toContain('item.allocationStatus?.lowercased() == "returned"');
    expect(gear).toContain('Image(systemName: "checkmark.circle.fill")');
    expect(gear).toContain("Color.statusBackground(.green)");
    expect(gear).toContain(".opacity(isReturned ? 0.55 : 1)");
    expect(gear).toContain('parts.append("Returned")');
  });

  it("decodes product name additively and prefers it as serialized gear subtitle", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");
    const collaborator = source("src/lib/collaborator-gear.ts");
    const bookingQueries = source("src/lib/services/bookings-queries.ts");
    const bookingsRoute = source("src/app/api/bookings/route.ts");

    expect(models).toContain("struct BookingAsset: Codable, Identifiable");
    expect(models).toContain("let name: String?");
    expect(models).toContain("name.nonBlankText ?? displayName.nonBlankText");
    expect(collaborator).toContain("name: item.asset.name");
    expect(bookingQueries).toContain("assetTag: true, name: true, brand: true");
    expect(bookingsRoute).toContain("assetTag: true, name: true, brand: true");
  });
});
