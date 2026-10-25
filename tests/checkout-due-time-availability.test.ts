import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCheckoutDueTime } from "@/lib/services/availability";

const now = new Date("2026-10-25T14:00:00.000Z");
const dueAt = new Date("2026-10-25T20:00:00.000Z");
const later = new Date("2026-10-26T02:00:00.000Z");
const booking = { id: "b1", locationId: "loc-1", endsAt: dueAt };

function fakeTx() {
  return {
    bookingSerializedItem: { findMany: vi.fn().mockResolvedValue([{ assetId: "cam-1" }]) },
    bookingBulkItem: {
      findMany: vi.fn()
        // The booking's own lines: 3 out, 1 already back.
        .mockResolvedValueOnce([{ bulkSkuId: "batt", checkedOutQuantity: 3, checkedInQuantity: 1 }, { bulkSkuId: "card", checkedOutQuantity: 2, checkedInQuantity: 2 }])
        // Another reservation later tonight wants 2 batteries.
        .mockResolvedValue([{ bulkSkuId: "batt", plannedQuantity: 2, checkedOutQuantity: 0 }]),
    },
    assetAllocation: { findMany: vi.fn().mockResolvedValue([]) },
    // One battery is left on the shelf.
    bulkStockBalance: { findMany: vi.fn().mockResolvedValue([{ bulkSkuId: "batt", onHandQuantity: 1 }]) },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => { vi.useRealTimers(); });

describe("checkCheckoutDueTime", () => {
  it("checks nothing when the due time does not move later", async () => {
    const tx = fakeTx();

    expect(await checkCheckoutDueTime(tx as never, booking, dueAt)).toEqual({ conflicts: [], shortages: [], unavailableAssets: [] });
    expect(tx.bookingSerializedItem.findMany).not.toHaveBeenCalled();
  });

  it("checks only the added window, overlap only, and credits the gear already in hand", async () => {
    const tx = fakeTx();

    const result = await checkCheckoutDueTime(tx as never, booking, later);

    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assetId: { in: ["cam-1"] }, startsAt: { lt: later }, endsAt: { gt: dueAt }, bookingId: { not: "b1" } }),
    }));
    // 2 held plus 1 on the shelf, minus 2 promised tonight, leaves 1 for the 2 still out.
    expect(result.shortages).toEqual([{ bulkSkuId: "batt", requested: 2, available: 1 }]);
    // A card line that came fully back asks for nothing.
    expect(tx.bulkStockBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "loc-1", bulkSkuId: { in: ["batt"] } } }));
  });

  it("starts the added window now when the checkout is already overdue", async () => {
    const tx = fakeTx();

    await checkCheckoutDueTime(tx as never, { ...booking, endsAt: new Date("2026-10-25T10:00:00.000Z") }, later);

    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ endsAt: { gt: now } }),
    }));
  });
});
