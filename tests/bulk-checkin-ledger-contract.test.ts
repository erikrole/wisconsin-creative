import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * Bulk check-in ledger convention: every `checkedInQuantity` increment must
 * carry its own CHECKIN stock movement (restock at the moment of physical
 * return), and completion paths reconcile from movement truth via
 * `settleBulkLedgerAtCompletion` instead of field math. Splitting these
 * conventions is how on-hand stock silently drifted in both directions.
 */
describe("bulk check-in ledger contract", () => {
  it("kiosk unit check-in scans restock at return time", () => {
    const scans = source("src/lib/services/bulk-unit-scans.ts");
    const increment = scans.indexOf("checkedInQuantity: { increment: 1 }");
    const restock = scans.indexOf("upsertBulkBalancesAndMovements", increment);
    expect(increment).toBeGreaterThan(-1);
    expect(restock).toBeGreaterThan(increment);
    expect(scans).toContain("kind: BulkMovementKind.CHECKIN");
  });

  it("every completion path settles the ledger from movements", () => {
    const checkin = source("src/lib/services/bookings-checkin.ts");
    const settleCalls = checkin.match(/settleBulkLedgerAtCompletion\(/g) ?? [];
    // maybeAutoComplete + markCheckoutCompleted + forceCompleteCheckout
    expect(settleCalls.length).toBe(3);
    // The old completion-time full restock is gone.
    expect(checkin).not.toContain("bulkStockReturn");
  });

  it("the settle helper sources outstanding quantities from movements, not fields", () => {
    const helpers = source("src/lib/services/bookings-helpers.ts");
    expect(helpers).toContain("settleBulkLedgerAtCompletion");
    expect(helpers).toContain("tx.bulkStockMovement.groupBy");
    expect(helpers).toContain("lostBySku");
  });
});
