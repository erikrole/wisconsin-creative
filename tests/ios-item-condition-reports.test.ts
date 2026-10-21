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
    expect(card).toContain("BookingDetailView(bookingId: bookingId)");
    expect(card).toContain("ZoomableImageViewer(url: photo.url, photoLabel: photo.label)");
    expect(card).toContain("Text(\"No photo attached\")");
    expect(card).toContain("Text(\"No description was provided.\")");
    expect(card).toContain("Text(\"Showing the five most recent reports.\")");
    expect(card).toContain("@ViewBuilder");
    expect(card).toContain("if report.isMissing {");
    expect(card).toContain("} else if report.isDamaged {");
  });

  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const items = source("ios/Wisconsin/Views/ItemsView.swift");
  const resolveRoute = source("src/app/api/damage-cases/[id]/resolve/route.ts");
  const reportRoute = source("src/app/api/assets/[id]/report/route.ts");

  it("decodes the damage-case fields without breaking older servers", () => {
    expect(models).toContain("let bookingId: String?");
    expect(models).toContain("decodeIfPresent(Booking.self, forKey: .booking)");
    expect(models).toContain("case resolution, resolvedAt, resolutionNote, resolvedBy");
    expect(models).toContain('"\\(outcome) by \\(name)"');
    expect(models).toContain("missing = (try? c.decodeIfPresent(Bool.self, forKey: .missing)) ?? false");
    expect(models).toContain('var statusLabel: String { missing && computedStatus == .maintenance ? "Missing"');
  });

  it("shows a red Missing status in the list and on the item", () => {
    expect(items).toContain("if asset.missing, asset.computedStatus == .maintenance { return .red }");
    expect(items).toContain("return asset.statusLabel");
    expect(itemDetail).toContain("missing: asset.missing");
    expect(itemDetail).toContain('if missing, status == .maintenance { return "Missing" }');
  });

  it("records outcomes through the case and hides Clear Maintenance while one is open", () => {
    expect(card).toContain('Label("Record outcome"');
    expect(card).toContain("RecordOutcomeSheet(report: report, onResolved: onResolved)");
    expect(card).toContain('Text("Reported from the item page")');
    expect(itemDetail).toContain("if !(asset.computedStatus == .maintenance && asset.hasOpenCase)");
    expect(models).toContain("isMissing ? [.found, .replaced, .writtenOff] : [.repaired, .replaced, .writtenOff, .noIssue]");
    expect(resolveRoute).toContain("resolution: z.nativeEnum(ReportResolution)");
    expect(apiClient).toContain('"/api/damage-cases/\\(reportId)/resolve"');
    expect(itemDetail).toContain('Button("Close case")');
  });

  it("lets students and staff report a problem, never collaborators or retired items", () => {
    expect(itemDetail).toContain('(role == "STUDENT" || role == "STAFF" || role == "ADMIN") && asset.computedStatus != .retired');
    expect(itemDetail).toContain('Text("It\'s damaged")');
    expect(itemDetail).toContain('Text("I can\'t find it")');
    expect(itemDetail).toContain("PhotosPicker(selection: $pickerItem");
    expect(itemDetail).toContain("isMissing || !trimmedNote.isEmpty || photoData != nil");
    expect(apiClient).toContain('"/api/assets/\\(assetId)/report"');
    expect(apiClient).toContain('isMissing ? "LOST" : "DAMAGED"');
    expect(reportRoute).toContain('user.role === "COLLABORATOR"');
  });

  it("asks for the camera for damage photos and keeps the capture fixtures debug-only", () => {
    for (const path of ["ios/project.yml", "ios/Wisconsin/Supporting/Info.plist", "ios/Wisconsin/KioskOnly/Info.plist"]) {
      expect(source(path)).toContain("to take photos of damaged gear");
    }
    const instrumentation = source("ios/Wisconsin/Core/PerformanceInstrumentation.swift");
    expect(instrumentation).toContain('case damageMissing = "damage-missing"');
    expect(instrumentation).toContain("static var damageRecordOutcome: Bool { matches(.damageRecordOutcome) }");
    expect(source("ios/Wisconsin/App/PerformanceTestHarness.swift")).toContain("private static var damageVariant: Data?");
  });

  it("hides new-booking actions for held items and opens the sheets full height", () => {
    expect(models).toContain("var isHeld: Bool { missing || computedStatus == .maintenance || computedStatus == .retired }");
    expect(itemDetail).toContain("if !asset.isHeld {");
    expect(itemDetail).not.toContain(".presentationDetents([.medium");
  });
});
