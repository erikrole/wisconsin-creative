import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk changes (H1, H2, H4, H5) and staff actions (C5)", () => {
  const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
  const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
  const changes = source("ios/Wisconsin/Kiosk/KioskChangesViews.swift");
  const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
  const sheet = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");
  const extendService = source("src/lib/services/kiosk-extend-window.ts");
  const transferRoute = source("src/app/api/kiosk/checkout/[id]/transfer/route.ts");
  const transferService = source("src/lib/services/kiosk-item-transfer.ts");
  const swapRoute = source("src/app/api/kiosk/checkout/[id]/swap/route.ts");
  const itemsRoute = source("src/app/api/kiosk/reservation/[id]/items/route.ts");

  it("H1 reads the extend window and decodes every field it returns", () => {
    expect(client).toContain('"/api/kiosk/checkout/\\(checkoutId)/extend-window"');
    const struct = models.slice(models.indexOf("struct KioskExtendWindow"));
    for (const key of ["currentEndsAt", "maxEndsAt", "limitingItem", "assetTag", "holderName", "startsAt"]) {
      expect(extendService).toContain(key);
      expect(struct).toContain(`let ${key}:`);
    }
    expect(changes).toContain("Can go until");
    // The PATCH stays the final word on the chosen time.
    expect(changes).toContain("kioskUpdateActiveCheckout(id: checkoutId, actorId: actorId, title: nil, endsAt: chosen, staffToken: staffToken)");
  });

  it("H2 transfers immediately with the route's body and no accept step", () => {
    expect(client).toContain('"/api/kiosk/checkout/\\(id)/transfer", method: "POST"');
    for (const key of ["actorId", "requestId", "expectedUpdatedAt", "targetUserId", "assetIds", "bulkUnitIds", "reason"]) {
      expect(transferRoute).toContain(key);
      expect(client).toContain(`let ${key}:`);
    }
    for (const key of ["targetBookingId", "sourceClosed", "itemCount"]) {
      expect(transferService).toContain(key);
      expect(models.slice(models.indexOf("struct KioskTransferResult"))).toContain(`let ${key}:`);
    }
    // Staff must send a reason; the holder need not.
    expect(changes).toContain("reason: actor.canManageAnyCheckout ? KioskTransferCopy.staffReason : nil");
    // Decision 2: H3 is dropped along with its copy.
    for (const file of [changes, hub, sheet]) {
      expect(file).not.toMatch(/taps? their name to accept/i);
    }
    expect(hub).toContain('Button("Transfer", systemImage: "arrow.left.arrow.right") { transferTarget = drawerContext(for: checkout) }');
  });

  it("H4 swaps through the atomic route and hands a problem to the damaged report", () => {
    expect(client).toContain('"/api/kiosk/checkout/\\(id)/swap", method: "POST"');
    expect(swapRoute).toContain("activeCheckoutSwapItemBody");
    expect(changes).toContain("Something's wrong with it");
    // Batteries can't be reported (the report keys on serialized items).
    expect(sheet).toContain("onReportProblem: item.isNumberedBulk ? nil : onReturn.map");
  });

  it("H5 stages edits and applies them in order, chaining updatedAt", () => {
    expect(changes).toContain("Nothing changes until you save.");
    expect(client).toContain("try container.encodeIfPresent(scanValue, forKey: .scanValue)");
    expect(itemsRoute).toContain("updatedAt: updated.updatedAt");
    expect(changes).toContain("if let updatedAt = result.updatedAt { expected = updatedAt }");
    // Adds go first so a swap's replacement lands before its original leaves.
    const ops = changes.slice(changes.indexOf("var operations: [Operation]"));
    expect(ops.indexOf("Operation.add")).toBeLessThan(ops.indexOf(".remove(itemId"));
    expect(changes).toContain("didn't go through");
  });

  it("C5 opens staff actions only after a staff ID card scan, without a kiosk admin override", () => {
    expect(changes).toContain('role == "ADMIN" || role == "STAFF"');
    expect(changes).toContain('Text("Scan your staff ID card")');
    expect(changes).toContain("KioskAPI.shared.kioskVerifyStaff(scanValue:");
    expect(changes).not.toContain('Text("Staff: tap your name")');
    expect(changes).not.toMatch(/Wiscard/);
    expect(changes.match(/staffToken: staffToken/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(sheet).toContain('Button("Staff actions")');
    expect(changes).not.toContain("Mark returned without scanning");
    expect(changes).toContain("KioskReturnReportView(");
  });
});
