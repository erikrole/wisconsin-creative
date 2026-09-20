import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type CancelBookingTx = {
  booking: Record<"findUnique" | "update", MockFn>;
  assetAllocation: Record<"updateMany", MockFn>;
  scanSession: Record<"updateMany", MockFn>;
  bulkStockBalance: Record<"findMany" | "upsert", MockFn>;
  bulkStockMovement: Record<"createMany", MockFn>;
  bookingBulkUnitAllocation: Record<"updateMany", MockFn>;
  bulkSkuUnit: Record<"updateMany", MockFn>;
  auditLog: Record<"create", MockFn>;
  user: Record<"findUnique", MockFn>;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn(), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
    bookingBulkUnitAllocation: { updateMany: vi.fn() },
    bulkSkuUnit: { updateMany: vi.fn() },
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
  checkAvailability: vi.fn().mockResolvedValue({ conflicts: [], shortages: [], unavailableAssets: [] }),
}));

vi.mock("@/lib/services/live-activities", () => ({
  endCheckoutReturnLiveActivities: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { cancelBooking, cancelReservation } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: CancelBookingTx })._mockTx;

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockTx.booking.update.mockResolvedValue({});
  mockTx.assetAllocation.updateMany.mockResolvedValue({});
  mockTx.scanSession.updateMany.mockResolvedValue({});
  mockTx.bulkStockBalance.findMany.mockResolvedValue([]);
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.createMany.mockResolvedValue({});
  mockTx.bookingBulkUnitAllocation.updateMany.mockResolvedValue({});
  mockTx.bulkSkuUnit.updateMany.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════════════════════
// cancelBooking
// ═══════════════════════════════════════════════════════════════════════════════
describe("cancelBooking", () => {
  it("sets a staged checkout to CANCELLED and deactivates allocations", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "PENDING_PICKUP",
    });

    const result = await cancelBooking("b-1", "actor-1");

    expect(result.success).toBe(true);
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "b-1" },
      data: { status: "CANCELLED" },
    });
    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b-1" },
      data: { active: false },
    });
    expect(endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("cancels open scan sessions", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "PENDING_PICKUP",
    });

    await cancelBooking("b-1", "actor-1");

    expect(mockTx.scanSession.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b-1", status: "OPEN" },
      data: { status: "CANCELLED" },
    });
  });

  it("returns reserved bulk stock when cancelling a pending pickup checkout", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1",
      kind: "CHECKOUT",
      status: "PENDING_PICKUP",
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "bulk-1", plannedQuantity: 3 }],
    });
    mockTx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "bulk-1", onHandQuantity: 7 },
    ]);

    await cancelBooking("b-1", "actor-1");

    expect(mockTx.bulkStockBalance.upsert).toHaveBeenCalledWith({
      where: { bulkSkuId_locationId: { bulkSkuId: "bulk-1", locationId: "loc-1" } },
      create: { bulkSkuId: "bulk-1", locationId: "loc-1", onHandQuantity: 10 },
      update: { onHandQuantity: 10 },
    });
    expect(mockTx.bulkStockMovement.createMany).toHaveBeenCalledWith({
      data: [{
        bulkSkuId: "bulk-1",
        locationId: "loc-1",
        bookingId: "b-1",
        actorUserId: "actor-1",
        kind: "CHECKIN",
        quantity: 3,
      }],
    });
  });

  it("rejects normal cancellation of active checkout custody", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1",
      kind: "CHECKOUT",
      status: "OPEN",
      locationId: "loc-1",
      bulkItems: [],
    });

    await expect(cancelBooking("b-1", "actor-1")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("returned at a kiosk"),
    });

    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    expect(endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
  });

  it("creates audit log entry", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "PENDING_PICKUP",
    });

    await cancelBooking("b-1", "actor-1");

    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "actor-1",
        entityType: "booking",
        entityId: "b-1",
        action: "cancelled",
      }),
    });
  });

  it("throws 404 when booking not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(cancelBooking("bad-id", "actor-1")).rejects.toThrow("Booking not found");
  });

  it("throws 400 when booking is already cancelled", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "CANCELLED",
    });
    await expect(cancelBooking("b-1", "actor-1")).rejects.toThrow("already cancelled");
  });

  it("throws 400 when booking is completed", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "COMPLETED",
    });
    await expect(cancelBooking("b-1", "actor-1")).rejects.toThrow("Cannot cancel a completed");
  });

  it("works for BOOKED reservations too", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "RESERVATION", status: "BOOKED",
    });

    const result = await cancelBooking("b-1", "actor-1");
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// cancelReservation
// ═══════════════════════════════════════════════════════════════════════════════
describe("cancelReservation", () => {
  it("cancels a BOOKED reservation", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "r-1", kind: "RESERVATION", status: "BOOKED",
    });

    const result = await cancelReservation("r-1", "actor-1");

    expect(result.success).toBe(true);
    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: "r-1" },
      data: { status: "CANCELLED" },
    });
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("throws 404 when not found", async () => {
    mockTx.booking.findUnique.mockResolvedValue(null);
    await expect(cancelReservation("bad-id", "actor-1")).rejects.toThrow("Reservation not found");
  });

  it("throws 400 when booking is a CHECKOUT", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "b-1", kind: "CHECKOUT", status: "OPEN",
    });
    await expect(cancelReservation("b-1", "actor-1")).rejects.toThrow("Only reservations");
  });

  // ── REGRESSION: route policy reads outside the transaction (TOCTOU) — the
  // service itself must refuse to cancel terminal reservations ──
  it("throws 400 when the reservation is already CANCELLED", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "r-1", kind: "RESERVATION", status: "CANCELLED",
    });
    await expect(cancelReservation("r-1", "actor-1")).rejects.toThrow("already cancelled");
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("throws 400 when the reservation is COMPLETED", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "r-1", kind: "RESERVATION", status: "COMPLETED",
    });
    await expect(cancelReservation("r-1", "actor-1")).rejects.toThrow("completed reservation");
    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("deactivates allocations and cancels scan sessions", async () => {
    mockTx.booking.findUnique.mockResolvedValue({
      id: "r-1", kind: "RESERVATION", status: "BOOKED",
    });

    await cancelReservation("r-1", "actor-1");

    expect(mockTx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "r-1" },
      data: { active: false },
    });
    expect(mockTx.scanSession.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "r-1", status: "OPEN" },
      data: { status: "CANCELLED" },
    });
  });
});
