import { describe, it, expect, vi, beforeEach } from "vitest";
import { BookingCustodyScope } from "@prisma/client";
import { makeBulkItem } from "./_helpers/factories";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type MarkCheckoutCompletedTx = {
  booking: Record<"findUnique" | "update", MockFn>;
  bookingSerializedItem: Record<"updateMany", MockFn>;
  bookingBulkItem: Record<"update", MockFn>;
  bookingBulkUnitAllocation: Record<"updateMany", MockFn>;
  assetAllocation: Record<"updateMany", MockFn>;
  bulkSkuUnit: Record<"updateMany", MockFn>;
  bulkStockBalance: Record<"findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"createMany" | "groupBy", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  overrideEvent: Record<"create", MockFn>;
  auditLog: Record<"create", MockFn>;
  user: Record<"findUnique", MockFn>;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    bookingSerializedItem: { updateMany: vi.fn() },
    bookingBulkItem: { update: vi.fn() },
    bookingBulkUnitAllocation: { updateMany: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    bulkSkuUnit: { updateMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn(), groupBy: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    overrideEvent: { create: vi.fn() },
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
import { forceCompleteCheckout, markCheckoutCompleted } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: MarkCheckoutCompletedTx })._mockTx;

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  // Default: no movements recorded — ledger settle finds nothing outstanding
  mockTx.bulkStockMovement.groupBy.mockResolvedValue([]);
  mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
});

function movementRow(bulkSkuId: string, kind: "CHECKOUT" | "CHECKIN", quantity: number) {
  return { bulkSkuId, kind, _sum: { quantity } };
}

describe("markCheckoutCompleted", () => {
  function openCheckout(bulkItems: unknown[] = []) {
    return {
      id: "b-1",
      kind: "CHECKOUT",
      status: "OPEN",
      locationId: "loc-1",
      requesterUserId: "user-1",
      custodyScope: BookingCustodyScope.PERSON,
      endsAt: new Date("2026-05-09T18:00:00.000Z"),
      bulkItems,
    };
  }

  it("uses SERIALIZABLE isolation", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout());
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when checkout not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(markCheckoutCompleted("bad-id", "actor-1")).rejects.toThrow("Checkout not found");
  });

  it("throws 404 when booking is not a CHECKOUT", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "RESERVATION", status: "BOOKED", bulkItems: [],
    });
    await expect(markCheckoutCompleted("b-1", "actor-1")).rejects.toThrow("Checkout not found");
  });

  it("throws 400 when checkout is not OPEN", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "COMPLETED", bulkItems: [],
    });
    await expect(markCheckoutCompleted("b-1", "actor-1")).rejects.toThrow("not open");
  });

  it("sets status to COMPLETED and deactivates allocations", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout());
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      })
    );
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "b-1" },
        data: { active: false },
      })
    );
    expect(endCheckoutReturnLiveActivities).toHaveBeenCalledWith("b-1");
  });

  it("closes open checkin scan sessions", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout());
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    expect(mockTx.scanSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: "b-1",
          phase: "CHECKIN",
          status: "OPEN",
        }),
        data: expect.objectContaining({
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      })
    );
  });

  it("creates audit log entry", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout());
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "actor-1",
          action: "checkin_completed",
        }),
      })
    );
  });

  // ── REGRESSION: only return unreturned items to stock ──────────────────
  it("restores only the movement-outstanding quantity (no double-return)", async () => {
    const bulkItem = makeBulkItem({
      bulkSkuId: "sku-1",
      plannedQuantity: 10,
      checkedOutQuantity: 10,
      checkedInQuantity: 5, // 5 already returned via checkinBulkItem
      bulkSku: { trackByNumber: false },
      unitAllocations: [],
    });
    // Movement truth: 10 checked out, 5 already restocked at return time
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      movementRow("sku-1", "CHECKOUT", 10),
      movementRow("sku-1", "CHECKIN", 5),
    ]);
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
    mockTx.bulkStockBalance.upsert.mockResolvedValue({});
    mockTx.bulkStockMovement.createMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    // Only the unreturned quantity (10 - 5 = 5) should be returned to stock
    const movementCall = mockTx.bulkStockMovement.createMany.mock.calls[0]?.[0];
    expect(movementCall?.data?.[0]?.quantity).toBe(5);
  });

  it("skips stock return when the movement ledger is already settled", async () => {
    const bulkItem = makeBulkItem({
      bulkSkuId: "sku-1",
      plannedQuantity: 10,
      checkedOutQuantity: 10,
      checkedInQuantity: 10, // all already returned
      bulkSku: { trackByNumber: false },
      unitAllocations: [],
    });
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      movementRow("sku-1", "CHECKOUT", 10),
      movementRow("sku-1", "CHECKIN", 10),
    ]);
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    // No stock movement should be created since all items were already returned
    expect(mockTx.bulkStockMovement.createMany).not.toHaveBeenCalled();
  });

  // ── REGRESSION: settle is movement-sourced, not field math. A checkout
  // whose returns predate per-scan restock has checkedInQuantity increments
  // with no CHECKIN movements — completion must restore the full checkout,
  // not out-minus-in, or those returns never reach the shelf ledger. ──
  it("self-heals legacy returns that never wrote a restock movement", async () => {
    const bulkItem = makeBulkItem({
      bulkSkuId: "sku-1",
      plannedQuantity: 10,
      checkedOutQuantity: 10,
      checkedInQuantity: 5, // returned via kiosk scans before per-scan restock existed
      bulkSku: { trackByNumber: false },
      unitAllocations: [],
    });
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      movementRow("sku-1", "CHECKOUT", 10),
      // no CHECKIN movements — legacy scans didn't write them
    ]);
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([bulkItem]));
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
    mockTx.bulkStockBalance.upsert.mockResolvedValue({});
    mockTx.bulkStockMovement.createMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    const movementCall = mockTx.bulkStockMovement.createMany.mock.calls[0]?.[0];
    expect(movementCall?.data?.[0]).toMatchObject({ bulkSkuId: "sku-1", quantity: 10 });
  });

  // ── REGRESSION: auto-LOST units must not restore stock or stay allocated ─
  it("excludes auto-LOST numbered units from the stock restore and closes their allocations", async () => {
    const plainBulk = makeBulkItem({
      id: "bulk-plain",
      bulkSkuId: "sku-plain",
      plannedQuantity: 5,
      checkedOutQuantity: 5,
      checkedInQuantity: 0,
      bulkSku: { trackByNumber: false },
      unitAllocations: [],
    });
    const numberedBulk = makeBulkItem({
      id: "bulk-numbered",
      bulkSkuId: "sku-numbered",
      plannedQuantity: 2,
      checkedOutQuantity: 2,
      checkedInQuantity: 1,
      bulkSku: { trackByNumber: true },
      unitAllocations: [
        { id: "alloc-lost", bulkSkuUnit: { id: "unit-lost", unitNumber: 19 } },
      ],
    });
    // Movement truth: plain 5 out / 0 in, numbered 2 out / 1 in (1 unit lost)
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      movementRow("sku-plain", "CHECKOUT", 5),
      movementRow("sku-numbered", "CHECKOUT", 2),
      movementRow("sku-numbered", "CHECKIN", 1),
    ]);
    mockTx.booking.findUnique.mockResolvedValue(openCheckout([plainBulk, numberedBulk]));
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.bookingBulkUnitAllocation.updateMany.mockResolvedValue({});
    mockTx.bulkSkuUnit.updateMany.mockResolvedValue({});
    mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
    mockTx.bulkStockBalance.upsert.mockResolvedValue({});
    mockTx.bulkStockMovement.createMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    // Plain bulk restores its full outstanding 5; the numbered SKU's
    // outstanding unit is LOST (physically gone), so its restore is
    // 2 out - 1 in - 1 lost = 0 and it must not appear in the movement.
    const movementCall = mockTx.bulkStockMovement.createMany.mock.calls[0]?.[0];
    expect(movementCall?.data).toHaveLength(1);
    expect(movementCall?.data?.[0]).toMatchObject({ bulkSkuId: "sku-plain", quantity: 5 });

    expect(mockTx.bulkSkuUnit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["unit-lost"] } },
        data: expect.objectContaining({ status: "LOST" }),
      }),
    );

    // The custody episode closes: an open allocation on a completed booking
    // would read as phantom "checked out" once the found unit is repaired.
    expect(mockTx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["alloc-lost"] } },
        data: { checkedInAt: expect.any(Date) },
      }),
    );
  });

  it("emits the returned badge event after completion", async () => {
    mockTx.booking.findUnique.mockResolvedValue(openCheckout());
    mockTx.booking.update.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await markCheckoutCompleted("b-1", "actor-1");

    expect(badges.onCheckoutReturned).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        bookingId: "b-1",
        completedAt: expect.any(Date),
        wasOnTime: expect.any(Boolean),
        sourceKey: "b-1",
      }),
    );
  });
});

describe("forceCompleteCheckout", () => {
  function openCheckout(overrides: Record<string, unknown> = {}) {
    return {
      id: "b-1",
      refNumber: "CO-0001",
      kind: "CHECKOUT",
      status: "OPEN",
      locationId: "loc-1",
      requesterUserId: "user-1",
      custodyScope: BookingCustodyScope.PERSON,
      endsAt: new Date("2026-05-09T18:00:00.000Z"),
      serializedItems: [{ id: "bsi-1", allocationStatus: "active", assetId: "asset-1" }],
      bulkItems: [],
      ...overrides,
    };
  }

  it("requires an explicit reason before writing", async () => {
    await expect(
      forceCompleteCheckout({ bookingId: "b-1", actorUserId: "actor-1", reason: "short" }),
    ).rejects.toThrow("reason");

    expect(transactionCalls).toHaveLength(0);
  });

  it("marks verified serialized and numbered bulk returns available instead of lost", async () => {
    const plainBulk = makeBulkItem({
      id: "bulk-plain",
      bulkSkuId: "sku-plain",
      plannedQuantity: 10,
      checkedOutQuantity: 10,
      checkedInQuantity: 4,
      unitAllocations: [],
    });
    const numberedBulk = makeBulkItem({
      id: "bulk-numbered",
      bulkSkuId: "sku-numbered",
      plannedQuantity: 2,
      checkedOutQuantity: 2,
      checkedInQuantity: 1,
      unitAllocations: [
        { id: "alloc-1", bulkSkuUnit: { id: "unit-1", unitNumber: 7 } },
      ],
    });
    // Movement truth: plain 10 out / 4 in, numbered 2 out / 1 in
    mockTx.bulkStockMovement.groupBy.mockResolvedValue([
      movementRow("sku-plain", "CHECKOUT", 10),
      movementRow("sku-plain", "CHECKIN", 4),
      movementRow("sku-numbered", "CHECKOUT", 2),
      movementRow("sku-numbered", "CHECKIN", 1),
    ]);
    mockTx.booking.findUnique.mockResolvedValue(openCheckout({ bulkItems: [plainBulk, numberedBulk] }));
    mockTx.bookingSerializedItem.updateMany.mockResolvedValue({});
    mockTx.bookingBulkItem.update.mockResolvedValue({});
    mockTx.bookingBulkUnitAllocation.updateMany.mockResolvedValue({});
    mockTx.assetAllocation.updateMany.mockResolvedValue({});
    mockTx.bulkSkuUnit.updateMany.mockResolvedValue({});
    mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
    mockTx.bulkStockBalance.upsert.mockResolvedValue({});
    mockTx.bulkStockMovement.createMany.mockResolvedValue({});
    mockTx.booking.update.mockResolvedValue({});
    mockTx.scanSession.updateMany.mockResolvedValue({});
    mockTx.overrideEvent.create.mockResolvedValue({});
    mockTx.auditLog.create.mockResolvedValue({});

    await forceCompleteCheckout({
      bookingId: "b-1",
      actorUserId: "actor-1",
      reason: "Scanner offline, all gear verified on shelf.",
    });

    expectSerializableIsolation(transactionCalls, 0);
    expect(mockTx.bookingSerializedItem.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b-1", allocationStatus: { not: "returned" } },
      data: { allocationStatus: "returned" },
    });
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b-1", active: true },
      data: { active: false },
    });
    expect(mockTx.bookingBulkItem.update).toHaveBeenCalledWith({
      where: { id: "bulk-plain" },
      data: { checkedInQuantity: 10 },
    });
    expect(mockTx.bookingBulkItem.update).toHaveBeenCalledWith({
      where: { id: "bulk-numbered" },
      data: { checkedInQuantity: 2 },
    });
    expect(mockTx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["alloc-1"] },
        }),
        data: { checkedInAt: expect.any(Date) },
      }),
    );
    expect(mockTx.bulkSkuUnit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["unit-1"] } },
      data: { status: "AVAILABLE" },
    });
    expect(mockTx.bulkSkuUnit.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "LOST" }) }),
    );
    expect(mockTx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b-1" },
        data: expect.objectContaining({ status: "COMPLETED", completedAt: expect.any(Date) }),
      }),
    );
    expect(mockTx.overrideEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "b-1",
          actorUserId: "actor-1",
          reason: "Scanner offline, all gear verified on shelf.",
        }),
      }),
    );
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "actor-1",
          action: "admin_force_completed_checkout",
        }),
      }),
    );
    expect(badges.onCheckoutReturned).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", bookingId: "b-1" }),
    );
  });
});
