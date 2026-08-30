import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Item Detail hierarchy", () => {
  const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
  const models = source("ios/Wisconsin/Models/AssetModels.swift");
  const assetRoute = source("src/app/api/assets/[id]/route.ts");

  it("keeps custody and the contextual reservation action ahead of metadata", () => {
    const hero = itemDetail.indexOf("ItemHeroCard(asset: asset");
    const custody = itemDetail.indexOf("ActiveBookingCard(booking: booking)");
    const reserve = itemDetail.indexOf("ReserveButton(title:");
    const details = itemDetail.indexOf("ItemDetailsCard(asset:");

    expect(hero).toBeGreaterThan(-1);
    expect(custody).toBeGreaterThan(hero);
    expect(reserve).toBeGreaterThan(custody);
    expect(details).toBeGreaterThan(reserve);
    expect(itemDetail).toContain('asset.computedStatus == .available ? "Reserve Equipment" : "Reserve for Later"');
    expect(itemDetail).toContain("ItemAvailabilityCard(");
    expect(itemDetail).toContain(".tint(Color.statusText(.purple))");
  });

  it("uses a compact branded hero without duplicate identity or status chrome", () => {
    expect(itemDetail).toContain("if dynamicTypeSize.isAccessibilitySize");
    expect(itemDetail).toContain("HStack(alignment: .center, spacing: Brand.Space.md)");
    expect(itemDetail).toContain(".font(.gothamBlack(size: 26, relativeTo: .title2))");
    expect(itemDetail).toContain('.navigationTitle(asset?.itemListPrimaryTitle ?? "Item")');
    expect(itemDetail).not.toContain("AssetStatusBadge(status: asset.computedStatus)");
    expect(itemDetail).not.toContain("showZoom");
    expect(itemDetail).not.toContain('accessibilityLabel("Open item photo")');
  });

  it("moves status below the hero and orders active custody as title, due time, then person", () => {
    expect(itemDetail).toContain('return "Available until \\(nextReservation.startsAt.formatted(date: .abbreviated, time: .shortened))"');
    expect(itemDetail).toContain("TimelineView(.periodic(from: .now, by: 60))");
    expect(itemDetail).toContain("Text(timing(now: context.date))");
    expect(itemDetail).toContain("return Date.itemDueLabel(for: booking.endsAt, now: now)");
    expect(itemDetail).toContain('components.joined(separator: ", ")');
    expect(itemDetail).toContain("StatusRail(tone: tone)");

    const activeCard = itemDetail.slice(itemDetail.indexOf("private struct ActiveBookingCard"), itemDetail.indexOf("// MARK: - Availability card"));
    expect(activeCard.indexOf("TimelineView(")).toBeLessThan(activeCard.indexOf("Text(booking.title)"));
    expect(activeCard.indexOf("Text(booking.title)")).toBeLessThan(activeCard.indexOf("Text(timing(now: context.date))"));
    expect(activeCard.indexOf("Text(timing(now: context.date))")).toBeLessThan(activeCard.indexOf("Text(booking.requesterName)"));
  });

  it("moves location into the hero and keeps secondary item information nested", () => {
    expect(itemDetail).toContain("DisclosureGroup(isExpanded: $isExpanded)");
    expect(itemDetail).toContain("Text(asset.location.name)");
    expect(itemDetail).not.toContain('Text("Current Location")');
    expect(itemDetail).toContain(".font(.caption)\n                    .foregroundStyle(.tertiary)");
    expect(itemDetail).toContain(".font(.caption.weight(.medium))\n                .foregroundStyle(.secondary)");
    expect(itemDetail).toContain("DisclosureGroup(isExpanded: $attachmentsExpanded)");
    expect(itemDetail).toContain('Label("Attachments", systemImage: "shippingbox")');
    expect(itemDetail).not.toContain("AccessoriesCard(accessories:");
  });

  it("surfaces upcoming reservations and routes to lazy newest-first previous bookings", () => {
    expect(assetRoute).toContain("history: bookingHistory.map((entry) => ({");
    expect(models).toContain("struct AssetBookingHistoryEntry: Codable, Identifiable");
    expect(models).toContain("let history: [AssetBookingHistoryEntry]");
    expect(models).toContain("history = try c.decodeIfPresent([AssetBookingHistoryEntry].self, forKey: .history) ?? []");
    expect(itemDetail).toContain("UpcomingReservationsCard(reservations: asset.upcomingReservations)");
    expect(itemDetail).toContain('Text("No upcoming reservations")');
    expect(itemDetail).toContain("reservations.sorted { $0.startsAt < $1.startsAt }");
    expect(itemDetail).toContain("ItemBookingsLinkCard(");
    expect(itemDetail).toContain('Section("Previous Bookings")');
    expect(itemDetail).toContain("BookingDetailView(bookingId: reservation.bookingId)");
    expect(itemDetail).toContain("BookingDetailView(bookingId: entry.booking.id)");
    expect(itemDetail).toContain(".sorted { $0.booking.endsAt > $1.booking.endsAt }");
    expect(itemDetail).toContain("@State private var visiblePreviousCount = 10");
    expect(itemDetail).toContain("visiblePreviousCount = min(visiblePreviousCount + 10, previousBookings.count)");

    const previousLink = itemDetail.slice(itemDetail.indexOf("private struct ItemBookingsLinkCard"), itemDetail.indexOf("private struct ItemBookingsView"));
    expect(previousLink).toContain('Text("Previous Bookings")');
    expect(previousLink).not.toContain("Color.statusText(.purple)");
    expect(previousLink).not.toContain('Text("Bookings")');
  });

  it("keeps the QR chip tappable without advertising a second copy affordance", () => {
    expect(itemDetail).toContain('.accessibilityLabel("QR code \\(qr), tap to copy")');
    expect(itemDetail).not.toContain('Image(systemName: "doc.on.doc")');
  });

  it("uses the native overflow menu for secondary item actions", () => {
    expect(itemDetail).toContain("Menu {");
    expect(itemDetail).toContain('Label("Edit…", systemImage: "pencil")');
    expect(itemDetail).toContain('Label("Copy QR Code", systemImage: "qrcode")');
    expect(itemDetail).toContain('Label("Open Product Link", systemImage: "arrow.up.right.square")');
    expect(itemDetail).toContain('.accessibilityLabel("More item actions")');
  });
});
