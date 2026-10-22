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
  it("leads with one status line and the name, and lets the bar pick up the name on scroll", () => {
    const hero = sliceBetween(detail, "private struct BookingHeroSection", "private struct BookingTimelineSection");
    const status = hero.indexOf("booking.detailStatusWord(now: now)");
    const title = hero.indexOf("Text(booking.title)");

    expect(status).toBeGreaterThanOrEqual(0);
    expect(status).toBeLessThan(title);
    expect(hero).toContain("Color.statusText(tone)");
    expect(hero).toContain('return "due in \\(label.dropFirst("DUE BACK IN ".count))"');
    expect(hero).not.toContain("StatusBadge(");
    expect(hero).not.toContain("booking.refNumber");
    expect(detail).toContain(".onScrollGeometryChange(for: Bool.self)");
    expect(detail).toContain("ToolbarItem(placement: .principal)");
    expect(detail).toContain(".opacity(showsBarTitle || booking == nil ? 1 : 0)");
  });

  it("uses the list row colors on detail too", () => {
    const tone = sliceBetween(detail, "func detailTone(now: Date)", "func detailStatusWord");
    expect(tone).toContain("return endsAt <= now ? .red : .blue");
    expect(tone).toContain("return startsAt < now ? .orange : .purple");
  });

  it("anchors Extend above the tab bar and leaves Cancel in scroll content", () => {
    expect(detail).toContain(".safeAreaInset(edge: .bottom, spacing: 0)");
    expect(detail).toContain("if canExtendBooking");
    expect(detail).toContain("BookingExtendBar(");
    expect(detail).toMatch(/Text\("Extend Return"\)[\s\S]*?\.buttonStyle\(\.borderedProminent\)/);
    expect(detail).toContain("if canCancelBooking");
    expect(detail).toContain('Text("Cancel Booking")');
  });

  it("keeps Extend available when later demand exists and explains the safe boundary", () => {
    const extendPolicy = sliceBetween(detail, "private var canExtendBooking", "private var canCancelBooking");
    expect(extendPolicy).toContain('booking.allows("extend") ?? legacyAllowed');
    expect(extendPolicy).not.toContain("returnInsight.hasUpcomingNeed");
    expect(detail).toContain("Extend only to a return time by then.");
    expect(detail).not.toContain("Extension unavailable.");
  });

  it("shows pickup and return as one trip card with progress while gear is out", () => {
    const timeline = sliceBetween(detail, "private struct BookingTimelineSection", "struct BookingTripCard");

    expect(timeline).toContain('booking.status == .open || booking.status == .completed ? "Picked up" : "Pickup"');
    expect(timeline).toContain('"Due back"');
    expect(timeline).toContain("progress: booking.status == .open ? progress(now: now) : nil");
    // Detail, Extend and Edit share one trip card so they read as one place.
    const card = sliceBetween(detail, "struct BookingTripCard", "private struct BookingAboutSection");
    expect(card).toContain("date.operationalDayLabel(now: today)");
    expect(source("ios/Wisconsin/Views/ExtendBookingSheet.swift")).toContain("BookingTripCard(");
    expect(sliceBetween(detail, "struct EditBookingSheet", "struct TransferBookingOwnerSheet")).toContain("BookingTripCard(");
    expect(timeline).not.toContain(".year(");
    expect(timeline).not.toContain("gearLong");
    expect(dates).toContain("let dayDistance = Calendar.current.dayOffset(of: self, from: now)");
    expect(dates).toContain('case 0: return "Today"');
    expect(dates).toContain("abs(dayDistance) < 7");
    expect(dates).toContain(".dateTime.weekday(.wide)");
    expect(dates).toContain(".dateTime.weekday(.abbreviated).month(.abbreviated).day()");
    expect(detail).toContain('"Needed again soon. Choose an earlier return time when extending."');
  });

  it("puts the owner with their face, and only adds events, kiosk and notes when they say something new", () => {
    const about = sliceBetween(detail, "private struct BookingAboutSection", "private extension Booking");

    expect(about).toContain("UserAvatarView(");
    expect(about).toContain("booking.requester.name");
    expect(about).not.toContain("booking.requester.email");
    expect(about).toContain(".filter { $0.caseInsensitiveCompare(booking.title) != .orderedSame }");
    // A kiosk that hasn't been used yet is noise, not a row.
    expect(about).toContain("if let kiosk = booking.pickupKioskDevice");
    expect(detail).not.toContain('"Not recorded"');
  });

  it("keeps Gear clean and gives returned rows a non-color cue", () => {
    const gear = sliceBetween(detail, "private struct EquipmentSection", "private struct ActionsSection");

    expect(gear).toContain('Text("Gear · ');
    expect(gear).not.toContain("equipmentItemPill");
    expect(gear).toContain('item.allocationStatus?.lowercased() == "returned"');
    expect(gear).toContain('Image(systemName: "checkmark.circle.fill")');
    expect(gear).not.toContain("Color.statusBackground(.green)");
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

  it("redesigns Extend as one before-and-after choice with a single green confirm", () => {
    const extend = source("ios/Wisconsin/Views/ExtendBookingSheet.swift");
    expect(extend).toContain("private var comparison: some View");
    expect(extend).toContain('title: "As late as possible"');
    expect(extend).toContain('title: "Another time"');
    expect(extend).toContain("ReturnTimeCalendar(");
    expect(extend).toContain('"Extend to \\(label(newEndsAt, lowercased: true))"');
    // One confirm only: no second Extend in the toolbar.
    expect(extend).not.toContain("placement: .confirmationAction");
    expect(extend).not.toContain("DayTimeChipPicker(");
    // A pre-selected choice is not an unsaved edit.
    expect(extend).toContain("private var hasChanges: Bool { didPick && hasNewReturn }");
  });
});
