import { describe, it, expect, vi, beforeEach } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;
type CheckinItemsTx = {
  booking: Record<"findUnique" | "update", MockFn>;
  bookingSerializedItem: Record<"updateMany" | "count", MockFn>;
  bookingBulkItem: Record<"findMany", MockFn>;
  assetAllocation: Record<"updateMany", MockFn>;
  bulkStockBalance: Record<"findUnique" | "findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"create" | "createMany" | "groupBy", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  auditLog: Record<"create", MockFn>;
  user: Record<"findUnique", MockFn>;
};

// Mock the db module
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    bookingSerializedItem: { updateMany: vi.fn(), count: vi.fn() },
    bookingBulkItem: { findMany: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    bulkStockBalance: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { create: vi.fn(), createMany: vi.fn(), groupBy: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }) },
  };
  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

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
import { checkinItems } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: CheckinItemsTx })._mockTx;

type OpenCheckout = ReturnType<typeof makeOpenCheckout>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no bulk items in checkout, ledger already settled
  mockTx.bookingBulkItem.findMany.mockResolvedValue([]);
  mockTx.bulkStockMovement.groupBy.mockResolvedValue([]);
  mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
});

function makeOpenCheckout(serializedItems: { assetId: string; allocationStatus: string }[]) {
  return {
    id: "booking-1",
    kind: "CHECKOUT",
    custodyScope: "PERSON",
    status: "OPEN",
    locationId: "loc-1",
    requesterUserId: "user-1",
    endsAt: new Date("2026-05-09T18:00:00.000Z"),
    serializedItems: serializedItems.map((item) => ({
      bookingId: "booking-1",
      assetId: item.assetId,
      allocationStatus: item.allocationStatus,
    })),
    bulkItems: [],
  };
}

describe("checkinItems", () => {
  it("returns items and keeps checkout OPEN when items remain", async () => {
    // 1 item remaining after returning a1
    mockTx.bookingSerializedItem.count.mockResolvedValue(1);
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
        { assetId: "a2", allocationStatus: "active" },
      ])
    );
    mockTx.bookingSerializedItem.count.mockResolvedValue(1); // 1 remaining after returning a1

    const result = await checkinItems("booking-1", "actor-1", ["a1"]);

    expect(result.success).toBe(true);
    expect(result.returnedAssetIds).toEqual(["a1"]);
    expect(result.remainingActiveItems).toBe(1);
    expect(result.autoCompleted).toBe(false);

    // Should mark items as returned (batched)
    expect(mockTx.bookingSerializedItem.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", assetId: { in: ["a1"] } },
      data: { allocationStatus: "returned" },
    });

    // Should deactivate allocations (batched)
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", assetId: { in: ["a1"] }, active: true },
      data: { active: false },
    });

    // Should NOT complete the booking
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("auto-completes checkout when all items returned", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
      ])
    );
    mockTx.bookingSerializedItem.count.mockResolvedValue(0); // none remaining

    const result = await checkinItems("booking-1", "actor-1", ["a1"]);

    expect(result.autoCompleted).toBe(true);
    expect(result.remainingActiveItems).toBe(0);

    // Should complete the booking
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        completedAt: expect.any(Date),
      }),
    });
    expect(endCheckoutReturnLiveActivities).toHaveBeenCalledWith("booking-1");
    expect(badges.onCheckoutReturned).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        bookingId: "booking-1",
        completedAt: expect.any(Date),
        sourceKey: "booking-1",
      }),
    );
  });

  it("rejects check-in of assets not in the checkout", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
      ])
    );

    await expect(
      checkinItems("booking-1", "actor-1", ["a999"])
    ).rejects.toThrow("Assets not in this checkout");
  });

  it("rejects check-in of already returned assets", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "returned" },
      ])
    );

    await expect(
      checkinItems("booking-1", "actor-1", ["a1"])
    ).rejects.toThrow("Assets already returned");
  });

  it("rejects check-in on non-OPEN checkout", async () => {
    const booking: OpenCheckout = {
      ...makeOpenCheckout([{ assetId: "a1", allocationStatus: "active" }]),
      status: "COMPLETED",
    };
    mockTx.booking.findUnique.mockResolvedValue(booking);

    await expect(
      checkinItems("booking-1", "actor-1", ["a1"])
    ).rejects.toThrow("Can only check in items from an open checkout");
  });

  it("rejects check-in on non-existent booking", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);

    await expect(
      checkinItems("booking-999", "actor-1", ["a1"])
    ).rejects.toThrow("Checkout not found");
  });

  it("creates audit log entry for partial check-in", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
        { assetId: "a2", allocationStatus: "active" },
      ])
    );
    mockTx.bookingSerializedItem.count.mockResolvedValue(1);

    await checkinItems("booking-1", "actor-1", ["a1"]);

    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "actor-1",
        entityType: "booking",
        entityId: "booking-1",
        action: "partial_checkin",
        afterJson: expect.objectContaining({ returnedAssetIds: ["a1"] }),
      }),
    });
  });

  // ── REGRESSION: bulk already returned incrementally (and restocked at
  // return time) must not be restocked again when the last serialized item
  // triggers auto-complete — that double-count inflated on-hand stock. ──
  it("auto-completes without a second restock when bulk was returned incrementally", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
      ])
    );
    mockTx.bookingSerializedItem.count.mockResolvedValue(0);
    // Bulk fully returned via checkinBulkItem, which already restocked
    mockTx.bookingBulkItem.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", plannedQuantity: 5, checkedOutQuantity: 5, checkedInQuantity: 5 },
    ]);
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      { bulkSkuId: "sku-1", kind: "CHECKOUT", _sum: { quantity: 5 } },
      { bulkSkuId: "sku-1", kind: "CHECKIN", _sum: { quantity: 5 } },
    ]);

    const result = await checkinItems("booking-1", "actor-1", ["a1"]);

    expect(result.autoCompleted).toBe(true);
    expect(mockTx.bulkStockMovement.createMany).not.toHaveBeenCalled();
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
  });

  it("creates auto-completion audit log when fully returned", async () => {
    mockTx.booking.findUnique.mockResolvedValue(
      makeOpenCheckout([
        { assetId: "a1", allocationStatus: "active" },
      ])
    );
    mockTx.bookingSerializedItem.count.mockResolvedValue(0);

    await checkinItems("booking-1", "actor-1", ["a1"]);

    // Should have two audit entries: partial_checkin + auto_completed
    const auditCalls = mockTx.auditLog.create.mock.calls;
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls[0]![0].data.action).toBe("partial_checkin");
    expect(auditCalls[1]![0].data.action).toBe("auto_completed_by_partial_checkin");
  });
});
