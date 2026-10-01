import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk return damaged / missing (G3–G6)", () => {
  const route = source("src/app/api/kiosk/checkin/[id]/report/route.ts");
  const service = source("src/lib/services/checkin-item-reports.ts");
  const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
  const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
  const report = source("ios/Wisconsin/Kiosk/KioskReturnReportView.swift");
  const returnView = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");

  it("posts the multipart fields the kiosk report route reads", () => {
    expect(client).toContain('"/api/kiosk/checkin/\\(bookingId)/report", method: "POST"');
    expect(client).toContain("multipart/form-data; boundary=");
    for (const field of ["actorId", "assetId", "type", "description"]) {
      expect(client).toContain(`("${field}", `);
      expect(service).toContain(`formData.get("${field}")`);
    }
    // The photo goes in `file` as a validated image type.
    expect(service).toContain('formData.get("file")');
    expect(client).toContain('name: "file", filename: "damage.jpg", contentType: "image/jpeg"');
    expect(report).toContain('type: "DAMAGED"');
    expect(report).toContain('type: "LOST"');
  });

  it("decodes every field the route returns", () => {
    const struct = models.slice(models.indexOf("struct KioskCheckinReportResult"));
    for (const key of ["success", "reportId", "type", "description", "imageUrl", "item", "checkoutTitle", "heldForStaff", "completed"]) {
      expect(route).toMatch(new RegExp(`\\b${key}\\b`));
      expect(struct).toContain(`let ${key}:`);
    }
    expect(service).toMatch(/asset: \{\s*id: assetId,\s*assetTag:/);
    expect(struct).toContain("let assetTag: String");
  });

  it("says a missing item is accounted for (decision 4), not kept on the record", () => {
    expect(report).toContain("It's accounted for, so this return can finish without it.");
    expect(report + returnView).not.toContain("stays on your record");
    expect(returnView).toContain("missingIds.subtracting(returnedIds).count");
  });

  it("opens the report page from one quiet link on the return screen", () => {
    expect(returnView).toContain('Text("Something damaged or missing?")');
    expect(returnView).toContain("reportStep = .choose(selectedId: nil)");
    expect(report).toContain('"Held for staff"');
    expect(report).toContain('"Marked missing"');
  });

  it("reports all gear: battery units and counted stock, not just serialized items", () => {
    for (const field of ["bulkSkuUnitId", "bulkSkuId", "quantity"]) {
      expect(client).toContain(`("${field}", `);
      expect(service).toContain(`formData.get("${field}")`);
    }
    expect(report).not.toContain("Batteries and counted supplies aren't listed");
    expect(report).toContain("KioskBatteryUnitChip(");
    expect(report).toContain("Stepper(value: $quantity");
    expect(returnView).toContain("$0.isNumberedBulk || ($0.isCountedStock");
    // Swift decodes the new fields leniently (older servers omit them).
    expect(models).toContain("var report: Report? = nil");
    expect(models).toContain("var quantity: Int? = nil");
  });

  it("never dead-ends damage: an item not yet back is scanned on the damaged page", () => {
    expect(report).toContain("store.scanner.claim(.returnReport)");
    expect(report).toContain("HIDScannerField(");
    expect(report).toContain('Button("Use the iPad camera")');
    expect(report).toContain("KioskAPI.shared.kioskCheckinScan(");
    expect(report).toContain("That's not \\(KioskReturnReportCopy.label(item)).");
  });
});
