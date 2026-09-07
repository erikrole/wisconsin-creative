import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
function source(file: string) { return readFileSync(path.join(process.cwd(), file), "utf8"); }

describe("item transfer client and provenance contract", () => {
  it("offers real transfers only on active, manageable checkout rows", () => {
    const equipment = source("src/app/(app)/bookings/BookingEquipmentTab.tsx");
    expect(equipment).toContain('booking.status === "OPEN"');
    expect(equipment).toContain('(booking.allowedActions ?? []).includes("manage-custody")');
    expect(equipment).toContain('canAssignHolder && item.allocationStatus === "active"');
    expect(equipment).toContain('Transfer item ownership');
    expect(equipment).not.toContain('With {item.assignee.name}');
  });
  it("refreshes both custody records and links to the receiving checkout", () => {
    const dialog = source("src/components/booking-details/AssignItemHolderDialog.tsx");
    expect(dialog).toContain("BOOKING_SNAPSHOT_HEADER");
    expect(dialog).toContain("onUpdated(updated);");
    expect(dialog).toContain("changedBookingIds: [booking.id, transfer.targetBookingId]");
    expect(dialog).toContain("/checkouts/${transfer.targetBookingId}");
    expect(dialog).not.toContain("The item stays on this checkout");
  });
  it("never rewrites scans, photos, handoff actors, physical stock, or return evidence", () => {
    const service = source("src/lib/services/booking-item-holder.ts");
    for (const table of ["scanEvent", "scanSession", "bookingPhoto", "checkinItemReport", "bulkStockMovement", "asset", "bookingBulkItem", "bookingBulkUnitAllocation"]) {
      expect(service).not.toMatch(new RegExp(`tx\\.${table}\\.(update|delete|create)`));
    }
    expect(service).not.toContain("onCheckoutReturned");
    expect(service).not.toContain("onCheckoutOpened");
  });
});
