import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), updateMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
    bookingBulkUnitAllocation: { updateMany: vi.fn() },
    bulkSkuUnit: { updateMany: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    db: {
      booking: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

vi.mock("@/lib/services/reservation-rules", () => ({
  loadReservationRules: vi.fn(async () => ({
    advanceWindowDays: null,
    noShowExpiryHours: 48,
    maxConcurrentReservations: null,
  })),
}));

vi.mock("@/lib/services/reservation-schedule", () => ({
  releaseReservationManagedAssignmentTx: vi.fn(async () => ({
    released: true,
    blocked: false,
    assignmentId: "assignment-1",
  })),
}));

vi.mock("@/lib/services/notifications", () => ({
  createShiftScheduleNotification: vi.fn(async () => undefined),
}));

import { db } from "@/lib/db";
import { expirePickupNoShows } from "@/lib/services/pending-pickup-expiry";
import { releaseReservationManagedAssignmentTx } from "@/lib/services/reservation-schedule";
import { createShiftScheduleNotification } from "@/lib/services/notifications";

const mockDb = db as unknown as {
  booking: { findMany: ReturnType<typeof vi.fn> };
  _mockTx: {
    booking: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    bulkStockBalance: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    bulkStockMovement: { createMany: ReturnType<typeof vi.fn> };
    bookingBulkUnitAllocation: { updateMany: ReturnType<typeof vi.fn> };
    bulkSkuUnit: { updateMany: ReturnType<typeof vi.fn> };
    assetAllocation: { updateMany: ReturnType<typeof vi.fn> };
    scanSession: { updateMany: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
};

const mockTx = mockDb._mockTx;
const now = new Date("2026-05-13T12:00:00.000Z");
const staleStart = new Date(now.getTime() - 49 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockDb.booking.findMany.mockResolvedValue([{ id: "booking-1" }]);
  mockTx.booking.findUnique.mockResolvedValue({
    id: "booking-1",
    kind: "CHECKOUT",
    status: "PENDING_PICKUP",
    startsAt: staleStart,
    locationId: "loc-1",
    createdBy: "creator-1",
    bulkItems: [
      {
        id: "bulk-item-1",
        bulkSkuId: "bulk-1",
        plannedQuantity: 3,
        checkedInQuantity: 0,
        unitAllocations: [{ bulkSkuUnitId: "unit-1" }],
      },
    ],
  });
  mockTx.booking.updateMany.mockResolvedValue({ count: 1 });
  mockTx.bulkStockBalance.findMany.mockResolvedValue([{ bulkSkuId: "bulk-1", onHandQuantity: 2 }]);
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.createMany.mockResolvedValue({});
  mockTx.bookingBulkUnitAllocation.updateMany.mockResolvedValue({});
  mockTx.bulkSkuUnit.updateMany.mockResolvedValue({});
  mockTx.assetAllocation.updateMany.mockResolvedValue({});
  mockTx.scanSession.updateMany.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
});

describe("expirePickupNoShows", () => {
  it("expires legacy pending checkouts with inventory release and system audit", async () => {
    const result = await expirePickupNoShows(now);

    expect(result).toMatchObject({ scanned: 1, expired: 1, failed: 0, errors: {} });
    expectSerializableIsolation(transactionCalls, 0);
    expect(mockDb.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          {
            kind: "RESERVATION",
            status: "BOOKED",
            OR: [
              { derivedCheckouts: { none: {} } },
              { endsAt: { lte: now } },
            ],
          },
          { kind: "CHECKOUT", status: "PENDING_PICKUP" },
        ],
        startsAt: { lt: new Date("2026-05-11T12:00:00.000Z") },
      }),
      take: 50,
    }));
    expect(mockTx.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        OR: [
          { kind: "RESERVATION", status: "BOOKED" },
          { kind: "CHECKOUT", status: "PENDING_PICKUP" },
        ],
        startsAt: { lt: new Date("2026-05-11T12:00:00.000Z") },
      },
      data: { status: "CANCELLED" },
    });
    expect(mockTx.bulkStockBalance.upsert).toHaveBeenCalledWith({
      where: { bulkSkuId_locationId: { bulkSkuId: "bulk-1", locationId: "loc-1" } },
      create: { bulkSkuId: "bulk-1", locationId: "loc-1", onHandQuantity: 5 },
      update: { onHandQuantity: 5 },
    });
    expect(mockTx.bulkStockMovement.createMany).toHaveBeenCalledWith({
      data: [{
        bulkSkuId: "bulk-1",
        locationId: "loc-1",
        bookingId: "booking-1",
        actorUserId: "creator-1",
        kind: "CHECKIN",
        quantity: 3,
        reason: "pending_pickup_auto_expired",
      }],
    });
    expect(mockTx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        bookingBulkItemId: { in: ["bulk-item-1"] },
        bulkSkuUnitId: { in: ["unit-1"] },
        checkedOutAt: { not: null },
        checkedInAt: null,
      },
      data: { checkedInAt: now },
    });
    expect(mockTx.bulkSkuUnit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["unit-1"] } },
      data: { status: "AVAILABLE" },
    });
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
      data: { active: false },
    });
    expect(mockTx.scanSession.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: undefined,
        entityType: "booking",
        entityId: "booking-1",
        action: "pending_pickup_expired",
      }),
    });
  });

  it("expires booked reservation no-shows without inventing stock restoration", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "reservation-1",
      kind: "RESERVATION",
      status: "BOOKED",
      startsAt: staleStart,
      locationId: "loc-1",
      createdBy: "creator-1",
      bulkItems: [{
        id: "bulk-item-1",
        bulkSkuId: "bulk-1",
        plannedQuantity: 3,
        checkedInQuantity: 0,
        unitAllocations: [],
      }],
    });

    const result = await expirePickupNoShows(now);

    expect(result).toMatchObject({ scanned: 1, expired: 1, failed: 0 });
    expectSerializableIsolation(transactionCalls, 0);
    expect(mockTx.booking.updateMany).toHaveBeenCalledOnce();
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(mockTx.bulkStockMovement.createMany).not.toHaveBeenCalled();
    expect(mockTx.bookingBulkUnitAllocation.updateMany).not.toHaveBeenCalled();
    expect(mockTx.bulkSkuUnit.updateMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "reservation-1" },
      data: { active: false },
    });
    expect(mockTx.scanSession.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "reservation-1", status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "reservation-1",
        action: "reservation_no_show_expired",
      }),
    });
  });

  it("skips candidates that are no longer stale inside the transaction", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      kind: "CHECKOUT",
      status: "PENDING_PICKUP",
      startsAt: new Date("2026-05-12T12:30:00.000Z"),
      locationId: "loc-1",
      createdBy: "creator-1",
      bulkItems: [],
    });

    const result = await expirePickupNoShows(now);

    expect(result).toMatchObject({ scanned: 1, expired: 0, failed: 0, errors: {} });
    expect(mockTx.booking.updateMany).not.toHaveBeenCalled();
  });

  describe("partially picked-up reservations", () => {
    function partialReservation(endsAt: Date) {
      return {
        id: "reservation-partial",
        kind: "RESERVATION",
        status: "BOOKED",
        startsAt: staleStart,
        endsAt,
        locationId: "loc-1",
        createdBy: "creator-1",
        shiftAssignmentId: "assignment-1",
        derivedCheckouts: [{ id: "checkout-1" }],
        serializedItems: [{ assetId: "asset-lens", allocationStatus: "active" }],
        bulkItems: [{
          id: "bulk-item-1",
          bulkSkuId: "bulk-1",
          plannedQuantity: 4,
          checkedOutQuantity: 2,
          checkedInQuantity: 0,
          unitAllocations: [],
        }],
      };
    }

    it("leaves a started pickup alone while its window is still open", async () => {
      mockTx.booking.findUnique.mockResolvedValue(
        partialReservation(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
      );

      const result = await expirePickupNoShows(now);

      expect(result).toMatchObject({ scanned: 1, expired: 0, failed: 0 });
      expect(mockTx.booking.updateMany).not.toHaveBeenCalled();
      expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
      expect(releaseReservationManagedAssignmentTx).not.toHaveBeenCalled();
      expect(createShiftScheduleNotification).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });

    it("completes an ended leftover without cancelling it or releasing the shift", async () => {
      const endsAt = new Date(now.getTime() - 60 * 60 * 1000);
      mockTx.booking.findUnique.mockResolvedValue(partialReservation(endsAt));

      const result = await expirePickupNoShows(now);

      expect(result).toMatchObject({ scanned: 1, expired: 1, failed: 0 });
      expectSerializableIsolation(transactionCalls, 0);
      expect(mockTx.booking.updateMany).toHaveBeenCalledOnce();
      expect(mockTx.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: "reservation-partial",
          kind: "RESERVATION",
          status: "BOOKED",
          endsAt: { lte: now },
        },
        data: { status: "COMPLETED", completedAt: now },
      });
      expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
        where: { bookingId: "reservation-partial", active: true },
        data: { active: false },
      });
      expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
      expect(releaseReservationManagedAssignmentTx).not.toHaveBeenCalled();
      expect(createShiftScheduleNotification).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledOnce();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: "reservation-partial",
          action: "reservation_leftover_expired",
        }),
      });
    });

    it("still cancels an untouched reservation no-show and releases its shift", async () => {
      mockTx.booking.findUnique.mockResolvedValue({
        ...partialReservation(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
        id: "reservation-untouched",
        derivedCheckouts: [],
        bulkItems: [{
          id: "bulk-item-1",
          bulkSkuId: "bulk-1",
          plannedQuantity: 4,
          checkedOutQuantity: 0,
          checkedInQuantity: 0,
          unitAllocations: [],
        }],
      });

      const result = await expirePickupNoShows(now);

      expect(result).toMatchObject({ expired: 1 });
      expect(mockTx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: "CANCELLED" },
      }));
      expect(releaseReservationManagedAssignmentTx).toHaveBeenCalledOnce();
      expect(createShiftScheduleNotification).toHaveBeenCalledWith("assignment-1", "removed");
    });
  });
});
