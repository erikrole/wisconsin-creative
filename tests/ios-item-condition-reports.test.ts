import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS item condition reports", () => {
  const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
  const models = source("ios/Wisconsin/Models/AssetModels.swift");
  const route = source("src/app/api/assets/[id]/route.ts");

  const card = itemDetail.slice(
    itemDetail.indexOf("private struct ItemConditionReportsCard"),
    itemDetail.indexOf("// MARK: - Item bookings"),
  );

  it("reads the staff report list the item route already returns", () => {
    expect(route).toContain('checkinReports: user.role === "ADMIN" || user.role === "STAFF"');
    expect(route).toContain("take: 5");
    expect(route).toContain("orderBy: [{ lastReportedAt: \"desc\" }, { id: \"desc\" }]");
    expect(models).toContain("struct AssetConditionReport");
    expect(models).toContain("compactMap(\\.report)");
    expect(models).toContain("decodeIfPresent([LenientConditionReport].self, forKey: .checkinReports)");
  });

  it("keeps reserve as the action and shows reports only to staff", () => {
    const reserve = itemDetail.indexOf("ReserveButton(title:");
    const reports = itemDetail.indexOf("ItemConditionReportsCard(");
    const upcoming = itemDetail.indexOf("UpcomingReservationsCard(reservations:");
    expect(reserve).toBeGreaterThan(-1);
    expect(reports).toBeGreaterThan(reserve);
    expect(upcoming).toBeGreaterThan(reports);
    expect(itemDetail).toContain("if canEditAsset, !asset.checkinReports.isEmpty");
    expect(card).not.toContain("toggleMaintenance");
    expect(card).not.toContain("Clear Maintenance");
  });

  it("uses status color, one checkout link, and a photo viewer", () => {
    expect(card).toContain("Text(\"Damage reported\")");
    expect(card).toContain("Text(\"Reported missing\")");
    expect(card).toContain("Color.statusText(.orange)");
    expect(card).toContain("Color.statusText(.red)");
    expect(card).toContain("BookingDetailView(bookingId: report.bookingId)");
    expect(card).toContain("ZoomableImageViewer(url: photo.url, photoLabel: photo.label)");
    expect(card).toContain("Text(\"No photo attached\")");
    expect(card).toContain("Text(\"No description was provided.\")");
    expect(card).toContain("Text(\"Showing the five most recent reports.\")");
    expect(card).toContain("@ViewBuilder");
    expect(card).toContain("if report.isMissing {");
    expect(card).toContain("} else if report.isDamaged {");
  });
});
