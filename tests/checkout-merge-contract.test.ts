import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("checkout merge source contracts", () => {
  it("keeps the merge transaction tied to custody and history rows", () => {
    const service = source("src/lib/services/checkout-consolidation.ts");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("tx.bookingSerializedItem.updateMany({");
    expect(service).toContain("tx.bookingBulkUnitAllocation.updateMany({");
    expect(service).toContain("tx.bulkStockMovement.updateMany({");
    expect(service).toContain('action: "checkouts_merged"');
    expect(service).toContain('action: "merged_into_checkout"');
    expect(service).toContain("Only event-linked checkouts can be merged");
    expect(service).toContain("Checkout return windows must match before merging");
    expect(service).toContain("allowContextOverrides");
    expect(service).toContain("checkAvailability(tx");
    expect(service).toContain("bookingDueDateChange.create");
    expect(service).toContain("contextResolution");
    expect(service).toContain("A checkout with returned or staged numbered units cannot be merged");
  });

  it("exposes the explicit staff repair surface without changing kiosk creation", () => {
    const list = source("src/components/BookingListPage.tsx");
    const dialog = source("src/components/CheckoutMergeDialog.tsx");
    const route = source("src/app/api/checkouts/merge/route.ts");
    const preview = source("src/app/api/checkouts/merge/preview/route.ts");
    expect(list).toContain('config.kind === "CHECKOUT" ? "Merge matching checkouts"');
    expect(list).toContain('"/api/checkouts/merge/preview"');
    expect(list).toContain("CheckoutMergeDialog");
    expect(list).toContain('item.status === mergeableStatus');
    expect(dialog).toContain('type="datetime-local"');
    expect(dialog).toContain("Return time");
    expect(dialog).toContain("Keep reservation link from");
    expect(dialog).toContain("allowContextOverrides: true");
    expect(route).toContain('requirePermission(user.role, "checkout", "merge")');
    expect(route).toContain("sourceReservationId");
    expect(preview).toContain("previewCheckoutMerge(body.ids, { allowContextOverrides: true })");
  });
});
