import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/badges", () => ({ badges: {} }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: vi.fn() }));

import { maybeAutoComplete } from "@/lib/services/bookings-checkin";

describe("return completion with a LOST report", () => {
  it("does not count an item with a LOST report on this booking as still out", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const tx = {
      bookingSerializedItem: { count },
      checkinItemReport: { findMany: vi.fn(async () => []) },
      bookingBulkItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(maybeAutoComplete(tx as never, "co-1", "loc-1", "u1", { auditAction: "x" })).resolves.toBeNull();
    expect(count).toHaveBeenCalledWith({
      where: {
        bookingId: "co-1",
        allocationStatus: "active",
        asset: { checkinReports: { none: { bookingId: "co-1", type: "LOST" } } },
      },
    });
  });
});

describe("return completion with bulk reported missing", () => {
  function completingTx(bulkItems: unknown[], lostReports: unknown[]) {
    return {
      bookingSerializedItem: { count: vi.fn().mockResolvedValue(0) },
      checkinItemReport: { findMany: vi.fn(async () => lostReports) },
      bookingBulkItem: { findMany: vi.fn().mockResolvedValue(bulkItems) },
      assetAllocation: { updateMany: vi.fn() },
      // Movements: 3 counted out, 1 returned; 1 battery out, 0 returned.
      bulkStockMovement: {
        groupBy: vi.fn(async () => [
          { bulkSkuId: "tape", kind: "CHECKOUT", _sum: { quantity: 3 } },
          { bulkSkuId: "tape", kind: "CHECKIN", _sum: { quantity: 1 } },
          { bulkSkuId: "batt", kind: "CHECKOUT", _sum: { quantity: 1 } },
        ]),
      },
      booking: { update: vi.fn() },
      scanSession: { updateMany: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ role: "STUDENT" })) },
      auditLog: { create: vi.fn() },
    };
  }

  it("finishes when missing quantity covers what is still owed, and never restocks it", async () => {
    const tx = completingTx(
      [
        { bulkSkuId: "tape", plannedQuantity: 3, checkedOutQuantity: 3, checkedInQuantity: 1 },
        { bulkSkuId: "batt", plannedQuantity: 1, checkedOutQuantity: 1, checkedInQuantity: 0 },
      ],
      [
        { bulkSkuId: "tape", quantity: 2, bulkSkuUnit: null },
        { bulkSkuId: null, quantity: null, bulkSkuUnit: { bulkSkuId: "batt" } },
      ],
    );
    // The tx has no bulkStockBalance and no movement writer: any restock of
    // the missing tape or battery would throw here.
    const completedAt = await maybeAutoComplete(tx as never, "co-1", "loc-1", "u1", { auditAction: "x" });
    expect(completedAt).toBeInstanceOf(Date);
    expect(tx.booking.update).toHaveBeenCalled();
    expect(tx.bulkStockMovement.groupBy).toHaveBeenCalled();
  });

  it("stays open while counted stock is still owed beyond what was reported missing", async () => {
    const tx = completingTx(
      [{ bulkSkuId: "tape", plannedQuantity: 3, checkedOutQuantity: 3, checkedInQuantity: 1 }],
      [{ bulkSkuId: "tape", quantity: 1, bulkSkuUnit: null }],
    );
    await expect(maybeAutoComplete(tx as never, "co-1", "loc-1", "u1", { auditAction: "x" })).resolves.toBeNull();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });
});
