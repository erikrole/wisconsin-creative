import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS kiosk reservation pickup contract", () => {
  it("routes booked reservations through the native pickup flow before or after their start time", () => {
    const studentRoute = source("src/app/api/kiosk/student/[userId]/route.ts");
    const detailRoute = source("src/app/api/kiosk/checkout/[id]/route.ts");
    const scanRoute = source("src/app/api/kiosk/pickup/[id]/scan/route.ts");
    const confirmRoute = source("src/app/api/kiosk/pickup/[id]/confirm/route.ts");
    const operatorHub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const apiClient = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");

    expect(studentRoute).toContain("dueReservations");
    expect(studentRoute).toContain("pendingPickups: [");
    expect(studentRoute).toContain("...pendingPickups.map");
    expect(studentRoute).toContain("...dueReservations.map");
    expect(detailRoute).toContain('booking.kind === "RESERVATION"');
    expect(scanRoute).toContain('booking.kind === "RESERVATION" && booking.status === "BOOKED"');
    expect(scanRoute).toContain("add_available");
    expect(scanRoute).toContain("preflightReservationPickupSerializedAdd");
    expect(scanRoute).toContain("addAndStageReservationPickupSerialized");
    expect(scanRoute).toContain('intent === "add"');
    expect(scanRoute).toContain("addedToPlan: true");
    expect(confirmRoute).toContain("sourceReservationId: sourceReservation.id");

    expect(models).toContain("struct KioskPendingPickup: Decodable, Identifiable");
    expect(operatorHub).toContain("startPickup(id: pickup.id, title: pickup.title, startsAt: pickup.startsAt)");
    expect(operatorHub).toContain("startPickup(id: res.id, title: res.title, startsAt: res.startsAt)");
    expect(operatorHub).toContain("source: .reservation");
    expect(operatorHub).toContain('accessibilityHint("Start pickup now")');
    expect(apiClient).toContain("func kioskCheckoutDetail(id: String)");
    expect(apiClient).toContain("func kioskPickupScan(");
    expect(apiClient).toContain("intent: String? = nil");
    expect(apiClient).toContain("func kioskPickupSubstitute(");
    expect(apiClient).toContain("func kioskUpdateReservationItem(");
    expect(apiClient).toContain("Body(actorId: actorId, scanValue: scanValue)");
    expect(apiClient).toContain("func kioskPickupConfirm(");
    expect(apiClient).toContain("partial: Bool = false");
  });

  it("binds numbered bulk units atomically with checkout creation and reservation fulfillment", () => {
    const confirmRoute = source("src/app/api/kiosk/pickup/[id]/confirm/route.ts");
    const lifecycle = source("src/lib/services/bookings-lifecycle.ts");

    // The route passes staged units into createBooking instead of binding them
    // in a second transaction after the reservation is already COMPLETED.
    expect(confirmRoute).toContain("bulkUnitItems,");
    expect(confirmRoute).not.toContain("Battery unit no longer matches this checkout");
    // Exactly one transaction remains in the route (the PENDING_PICKUP branch).
    expect(confirmRoute.match(/db\.\$transaction/g)).toHaveLength(1);

    // createBooking owns the unit bind inside its SERIALIZABLE transaction.
    expect(lifecycle).toContain("bulkUnitItems?: Array<{ bulkSkuId: string; unitNumber: number }>");
    expect(lifecycle).toContain("status: BulkUnitStatus.CHECKED_OUT");
    expect(lifecycle).toContain("bookingBulkUnitAllocation.createMany");
    expect(lifecycle).toContain("checkoutUnitCountBySku.get(item.bulkSkuId)");
    const numberedBind = lifecycle.slice(
      lifecycle.indexOf("// Bind exact numbered bulk units"),
      lifecycle.indexOf("const actorRole", lifecycle.indexOf("// Bind exact numbered bulk units")),
    );
    expect(numberedBind).not.toContain("await tx.bookingBulkItem.update({");

    // The bind must cover exactly plannedQuantity per numbered SKU — the
    // ledger was decremented by planned, so under- or over-binding desyncs
    // custody from stock from the first minute.
    expect(lifecycle).toContain("if (bound !== item.plannedQuantity)");

    // Duplicate staged scans cannot satisfy planned quantity or double-bind.
    expect(confirmRoute).toContain("stagedUnitNumbers");
    expect(confirmRoute).toContain("sourceReservationPickup: true");
    expect(confirmRoute).toContain("Partial pickup is only available for reservations");
    expect(confirmRoute).toContain("remainingItemNames");

    // Already-done confirms read as success states, not raw status leaks.
    expect(confirmRoute).toContain("This reservation was already picked up");
    expect(confirmRoute).toContain("This pickup was already confirmed");
  });

  it("preconfirms aggregate quantity rows while retaining scans for numbered families", () => {
    const detailRoute = source("src/app/api/kiosk/checkout/[id]/route.ts");
    const confirmRoute = source("src/app/api/kiosk/pickup/[id]/confirm/route.ts");
    const pickupView = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");

    expect(detailRoute).toContain('type: "bulk_quantity" as const');
    expect(detailRoute).toMatch(/if \(!bi\.bulkSku\.trackByNumber\)[\s\S]*?returned: true/);
    expect(confirmRoute).toContain("item.bulkSku.trackByNumber &&");
    expect(confirmRoute).toContain("if (!item.bulkSku.trackByNumber) {");

    // Native pickup already treats returned detail rows as confirmed, so one
    // aggregate quantity row can complete without inventing unit-level scans.
    expect(pickupView).toContain("for item in loaded.items where item.returned");
    expect(pickupView).toContain("confirmedIds.insert(item.id)");
    expect(pickupView).toContain("private var allConfirmed: Bool");
    expect(pickupView).toContain("private var canConfirmPartial: Bool");
    expect(pickupView).toContain("partial: isPartial");
  });

  it("prompts Add or Discard before an off-plan pickup scan mutates the reservation", () => {
    const scanRoute = source("src/app/api/kiosk/pickup/[id]/scan/route.ts");
    const pickupView = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const add = source("src/lib/services/kiosk-pickup-add.ts");

    expect(scanRoute).toContain('errorCode: "add_available"');
    expect(scanRoute).not.toContain("findPickupSubstitutionCandidate");
    expect(add).toContain("preflightReservationPickupSerializedAdd");
    expect(add).toContain("kioskAvailabilityBlockMessage");
    expect(add).toContain("kiosk_pickup_item_added");
    expect(pickupView).toContain('"Add this item?"');
    expect(pickupView).toContain('"Can\'t add this item"');
    expect(pickupView).toContain("presentBlockedAdd");
    expect(pickupView).toContain("blockedAddErrorCodes");
    expect(pickupView).toContain('Button("Discard", role: .cancel)');
    expect(pickupView).toContain("KioskScanFeedbackSound.playFailure()");
    expect(pickupView).toContain("presentAddOrDiscard");
    expect(pickupView).toContain("removeRemainingItem");
    expect(pickupView).toContain('intent: "add"');
  });
});
