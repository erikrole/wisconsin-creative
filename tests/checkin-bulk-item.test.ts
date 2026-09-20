import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeBulkItem } from "./_helpers/factories";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type CheckinBulkTx = {
  booking: Record<"findUnique" | "update", MockFn>;
  bookingBulkItem: Record<"update" | "findMany", MockFn>;
  bookingSerializedItem: Record<"count", MockFn>;
  bulkStockBalance: Record<"findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"createMany" | "groupBy", MockFn>;
  assetAllocation: Record<"updateMany", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  auditLog: Record<"create", MockFn>;
  user: Record<"findUnique", MockFn>;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    bookingBulkItem: { update: vi.fn(), findMany: vi.fn() },
    bookingSerializedItem: { count: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn(), groupBy: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }) },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: vi.fn().mockResolvedValue({ conflicts: [] }),
}));

vi.mock("@/lib/badges", () => ({
  badges: {
    onCheckoutReturned: vi.fn(),
  },
}));

vi.mock("@/lib/services/live-activities", () => ({
  endCheckoutReturnLiveActivities: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { badges } from "@/lib/badges";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { checkinBulkItem } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: CheckinBulkTx })._mockTx;

function openCheckout(bulkItems: unknown[] = []) {
  return {
    id: "b-1",
    kind: "CHECKOUT",
    custodyScope: "PERSON",
    status: "OPEN",
    locationId: "loc-1",
    requesterUserId: "user-1",
    endsAt: new Date("2026-05-09T18:00:00.000Z"),
    serializedItems: [],
    bulkItems,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockTx.bookingBulkItem.update.mockResolvedValue({});
  mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.createMany.mockResolvedValue({});
  mockTx.bulkStockMovement.groupBy.mockResolvedValue([]);
  mockTx.auditLog.create.mockResolvedValue({});
  // Default: not auto-completing (active items remain)
  mockTx.bookingSerializedItem.count.mockResolvedValue(0);
  mockTx.bookingBulkItem.findMany.mockResolvedValue([
    { checkedInQuantity: 3, checkedOutQuantity: 10, plannedQuantity: 10 },
  ]);
});

describe("checkinBulkItem", () => {
  const bulkItem = makeBulkItem({
    id: "bi-1",
    bookingId: "b-1",
    bulkSkuId: "sku-1",
    plannedQuantity: 10,
    checkedOutQuantity: 10,
    checkedInQuantity: 3,
  });

  it("increments checkedInQuantity", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));

    const result = await checkinBulkItem("b-1", "actor-1", "bi-1", 2);

    expect(result.success).toBe(true);
    expect(result.checkedInQuantity).toBe(5); // 3 + 2
    expect(mockTx.bookingBulkItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bi-1" },
        data: { checkedInQuantity: 5 },
      })
    );
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("returns stock to location balance", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    await checkinBulkItem("b-1", "actor-1", "bi-1", 2);

    expect(mockTx.bulkStockMovement.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            bulkSkuId: "sku-1",
            quantity: 2,
            kind: "CHECKIN",
          }),
        ]),
      })
    );
  });

  it("throws 404 when checkout not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(checkinBulkItem("bad", "actor-1", "bi-1", 1)).rejects.toThrow("Checkout not found");
  });

  it("throws 404 when booking is RESERVATION", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "RESERVATION", status: "BOOKED", serializedItems: [], bulkItems: [],
    });
    await expect(checkinBulkItem("b-1", "actor-1", "bi-1", 1)).rejects.toThrow("Checkout not found");
  });

  it("throws 400 when checkout is not OPEN", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "COMPLETED", serializedItems: [], bulkItems: [bulkItem],
    });
    await expect(checkinBulkItem("b-1", "actor-1", "bi-1", 1)).rejects.toThrow("only check in items from an open");
  });

  it("throws 400 when bulk item not in checkout", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    await expect(checkinBulkItem("b-1", "actor-1", "wrong-id", 1)).rejects.toThrow("Bulk item not in this checkout");
  });

  it("throws 400 for zero quantity", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    await expect(checkinBulkItem("b-1", "actor-1", "bi-1", 0)).rejects.toThrow("Invalid quantity");
  });

  it("throws 400 for quantity exceeding remaining", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    // remaining = 10 - 3 = 7, trying to return 8
    await expect(checkinBulkItem("b-1", "actor-1", "bi-1", 8)).rejects.toThrow("Invalid quantity");
  });

  it("auto-completes when all items returned", async () => {
    const fullyReturned = makeBulkItem({
      id: "bi-1",
      bookingId: "b-1",
      bulkSkuId: "sku-1",
      plannedQuantity: 5,
      checkedOutQuantity: 5,
      checkedInQuantity: 4, // returning 1 more = complete
    });
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([fullyReturned]));
    // After update, all bulk items are fully returned
    mockTx.bookingBulkItem.findMany.mockResolvedValue([
      { checkedInQuantity: 5, checkedOutQuantity: 5, plannedQuantity: 5 },
    ]);
    mockTx.bookingSerializedItem.count.mockResolvedValue(0);
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});

    const result = await checkinBulkItem("b-1", "actor-1", "bi-1", 1);

    expect(result.autoCompleted).toBe(true);
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "b-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        completedAt: expect.any(Date),
      }),
    });
    expect(endCheckoutReturnLiveActivities).toHaveBeenCalledWith("b-1");
    expect(badges.onCheckoutReturned).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        bookingId: "b-1",
        completedAt: expect.any(Date),
        sourceKey: "b-1",
      }),
    );
  });

  it("creates audit log", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    await checkinBulkItem("b-1", "actor-1", "bi-1", 2);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "partial_bulk_checkin",
        }),
      })
    );
  });
});
