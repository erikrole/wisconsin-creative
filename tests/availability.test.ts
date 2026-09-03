import { describe, it, expect, vi } from "vitest";
import { BookingStatus } from "@prisma/client";

// No module mocking needed — these functions accept tx as a parameter
import {
  checkSerializedConflicts,
  checkUpcomingSerializedCommitments,
  checkSerializedTurnaroundRisks,
  checkBulkTurnaroundRisks,
  checkBulkShortages,
  checkAssetStatuses,
  checkAvailability,
} from "@/lib/services/availability";

function createMockTx() {
  return {
    assetAllocation: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn() },
    bookingBulkItem: { groupBy: vi.fn(), findMany: vi.fn() },
    checkinItemReport: { findMany: vi.fn() },
  };
}

type AvailabilityTx = Parameters<typeof checkAvailability>[0];

function availabilityTx(tx: ReturnType<typeof createMockTx>): AvailabilityTx {
  return tx as unknown as AvailabilityTx;
}

// ═════════════════════════════════════════════════════════════════════════════
// checkSerializedConflicts
// ═════════════════════════════════════════════════════════════════════════════
describe("checkSerializedConflicts", () => {
  it("returns empty for no asset IDs", async () => {
    const tx = createMockTx();
    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: [],
      startsAt: new Date("2026-04-01"),
      endsAt: new Date("2026-04-02"),
    });
    expect(result).toEqual([]);
    expect(tx.assetAllocation.findMany).not.toHaveBeenCalled();
  });

  it("detects overlapping allocations", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([{
      assetId: "a-1",
      bookingId: "b-other",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
      booking: { title: "Other booking" },
    }]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T10:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.assetId).toBe("a-1");
    expect(result[0]!.conflictingBookingId).toBe("b-other");
  });

  it("allows reuse when an earlier booking ends exactly at the serialized turnaround buffer", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual([]);
    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startsAt: { lt: new Date("2026-04-01T13:00:00Z") },
          endsAt: { gt: new Date("2026-04-01T07:00:00Z") },
        }),
      }),
    );
  });

  it("blocks a new booking that ends inside the next booking turnaround buffer", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([{
      assetId: "a-1",
      bookingId: "b-next",
      startsAt: new Date("2026-04-01T12:30:00Z"),
      endsAt: new Date("2026-04-01T14:00:00Z"),
      booking: { title: "Next booking" },
    }]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual([{
      assetId: "a-1",
      conflictingBookingId: "b-next",
      conflictingBookingTitle: "Next booking",
      startsAt: new Date("2026-04-01T12:30:00Z"),
      endsAt: new Date("2026-04-01T14:00:00Z"),
    }]);
  });

  it("blocks reuse when an earlier booking ends inside the serialized turnaround buffer", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([{
      assetId: "a-1",
      bookingId: "b-too-tight",
      startsAt: new Date("2026-04-01T06:00:00Z"),
      endsAt: new Date("2026-04-01T07:30:00Z"),
      booking: { title: "Too tight" },
    }]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual([{
      assetId: "a-1",
      conflictingBookingId: "b-too-tight",
      conflictingBookingTitle: "Too tight",
      startsAt: new Date("2026-04-01T06:00:00Z"),
      endsAt: new Date("2026-04-01T07:30:00Z"),
    }]);
  });

  it("can check actual overlap without the turnaround buffer for active-checkout extensions", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([]);

    const startsAt = new Date("2026-04-01T08:00:00Z");
    const endsAt = new Date("2026-04-01T12:00:00Z");
    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt,
      endsAt,
      enforceTurnaroundBuffer: false,
    });

    expect(result).toEqual([]);
    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        }),
      }),
    );
  });

  it("blocks reuse when an earlier booking runs past the next pickup time", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([{
      assetId: "a-1",
      bookingId: "b-late",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:01Z"),
      booking: { title: "Late return" },
    }]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:01Z"),
    });

    expect(result).toEqual([{
      assetId: "a-1",
      conflictingBookingId: "b-late",
      conflictingBookingTitle: "Late return",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:01Z"),
    }]);
  });

  it("treats pending pickup allocations as active conflicts", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([{
      assetId: "a-1",
      bookingId: "b-pickup",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
      booking: { title: "Pending pickup" },
    }]);

    const result = await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01T10:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual([{
      assetId: "a-1",
      conflictingBookingId: "b-pickup",
      conflictingBookingTitle: "Pending pickup",
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    }]);
    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          booking: {
            status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] },
          },
        }),
      }),
    );
  });

  it("excludes specified booking from conflict check", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([]);

    await checkSerializedConflicts(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      startsAt: new Date("2026-04-01"),
      endsAt: new Date("2026-04-02"),
      excludeBookingId: "b-self",
    });

    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: { not: "b-self" },
        }),
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkUpcomingSerializedCommitments
// ═════════════════════════════════════════════════════════════════════════════
describe("checkUpcomingSerializedCommitments", () => {
  it("returns empty for no asset IDs", async () => {
    const tx = createMockTx();
    const result = await checkUpcomingSerializedCommitments(availabilityTx(tx), {
      serializedAssetIds: [],
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });
    expect(result).toEqual([]);
    expect(tx.assetAllocation.findMany).not.toHaveBeenCalled();
  });

  it("returns the next future commitment per asset after the requested end time", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([
      {
        assetId: "a-1",
        bookingId: "b-next",
        startsAt: new Date("2026-04-02T08:00:00Z"),
        endsAt: new Date("2026-04-02T12:00:00Z"),
        booking: { title: "Morning shoot", status: "BOOKED" },
      },
      {
        assetId: "a-1",
        bookingId: "b-later",
        startsAt: new Date("2026-04-03T08:00:00Z"),
        endsAt: new Date("2026-04-03T12:00:00Z"),
        booking: { title: "Later shoot", status: "BOOKED" },
      },
      {
        assetId: "a-2",
        bookingId: "b-other",
        startsAt: new Date("2026-04-04T08:00:00Z"),
        endsAt: new Date("2026-04-04T12:00:00Z"),
        booking: { title: "Other item", status: "PENDING_PICKUP" },
      },
    ]);

    const result = await checkUpcomingSerializedCommitments(availabilityTx(tx), {
      serializedAssetIds: ["a-1", "a-2"],
      endsAt: new Date("2026-04-01T17:00:00Z"),
      excludeBookingId: "b-self",
    });

    expect(result).toEqual([
      {
        assetId: "a-1",
        bookingId: "b-next",
        bookingTitle: "Morning shoot",
        startsAt: new Date("2026-04-02T08:00:00Z"),
        endsAt: new Date("2026-04-02T12:00:00Z"),
        status: "BOOKED",
        nextLocationId: null,
        nextLocationName: null,
      },
      {
        assetId: "a-2",
        bookingId: "b-other",
        bookingTitle: "Other item",
        startsAt: new Date("2026-04-04T08:00:00Z"),
        endsAt: new Date("2026-04-04T12:00:00Z"),
        status: "PENDING_PICKUP",
        nextLocationId: null,
        nextLocationName: null,
      },
    ]);
    expect(tx.assetAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startsAt: { gte: new Date("2026-04-01T17:00:00Z") },
          bookingId: { not: "b-self" },
          booking: {
            status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] },
          },
        }),
        orderBy: [{ assetId: "asc" }, { startsAt: "asc" }],
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkSerializedTurnaroundRisks
// ═════════════════════════════════════════════════════════════════════════════
describe("checkSerializedTurnaroundRisks", () => {
  it("flags short turnaround and next-location transfer risk", async () => {
    const tx = createMockTx();
    tx.checkinItemReport.findMany.mockResolvedValue([]);

    const result = await checkSerializedTurnaroundRisks(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      locationId: "loc-current",
      endsAt: new Date("2026-04-01T20:00:00Z"),
      upcomingCommitments: [{
        assetId: "a-1",
        bookingId: "b-next",
        bookingTitle: "Morning shoot",
        startsAt: new Date("2026-04-02T08:00:00Z"),
        endsAt: new Date("2026-04-02T12:00:00Z"),
        status: BookingStatus.BOOKED,
        nextLocationId: "loc-away",
        nextLocationName: "Camp Randall",
      }],
      now: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: "a-1",
        code: "SHORT_TURNAROUND",
        severity: "warning",
        message: "Needed next in 12h",
        gapMinutes: 720,
      }),
      expect.objectContaining({
        assetId: "a-1",
        code: "LOCATION_TRANSFER",
        severity: "warning",
        message: "Needed next at Camp Randall; confirm transfer time",
        nextLocationName: "Camp Randall",
      }),
    ]));
  });

  it("marks a two-hour-or-closer handoff as very tight without blocking it", async () => {
    const tx = createMockTx();
    tx.checkinItemReport.findMany.mockResolvedValue([]);

    const result = await checkSerializedTurnaroundRisks(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      locationId: "loc-1",
      endsAt: new Date("2026-04-01T20:00:00Z"),
      upcomingCommitments: [{
        assetId: "a-1",
        bookingId: "b-next",
        bookingTitle: "Next shoot",
        startsAt: new Date("2026-04-01T21:30:00Z"),
        endsAt: new Date("2026-04-01T22:30:00Z"),
        status: BookingStatus.BOOKED,
        nextLocationId: "loc-1",
        nextLocationName: "Main gear room",
      }],
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "SHORT_TURNAROUND",
        severity: "critical",
        message: "Needed next in 1h 30m",
        gapMinutes: 90,
      }),
    ]));
  });

  it("does not raise a transfer notice for a distant future booking", async () => {
    const tx = createMockTx();
    tx.checkinItemReport.findMany.mockResolvedValue([]);

    const result = await checkSerializedTurnaroundRisks(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      locationId: "loc-1",
      endsAt: new Date("2026-04-01T20:00:00Z"),
      upcomingCommitments: [{
        assetId: "a-1",
        bookingId: "b-next",
        bookingTitle: "Next month shoot",
        startsAt: new Date("2026-04-03T08:00:00Z"),
        endsAt: new Date("2026-04-03T12:00:00Z"),
        status: BookingStatus.BOOKED,
        nextLocationId: "loc-away",
        nextLocationName: "Camp Randall",
      }],
    });

    expect(result).toEqual([]);
  });

  it("flags recent damaged or lost reports for selected assets", async () => {
    const tx = createMockTx();
    tx.checkinItemReport.findMany.mockResolvedValue([
      {
        assetId: "a-1",
        type: "DAMAGED",
        createdAt: new Date("2026-04-01T10:00:00Z"),
        booking: { id: "b-report", title: "Previous checkout" },
      },
      {
        assetId: "a-2",
        type: "LOST",
        createdAt: new Date("2026-04-01T09:00:00Z"),
        booking: { id: "b-lost", title: "Lost checkout" },
      },
    ]);

    const result = await checkSerializedTurnaroundRisks(availabilityTx(tx), {
      serializedAssetIds: ["a-1", "a-2"],
      locationId: "loc-1",
      endsAt: new Date("2026-04-01T20:00:00Z"),
      upcomingCommitments: [],
      now: new Date("2026-04-02T12:00:00Z"),
    });

    expect(result).toEqual([
      expect.objectContaining({
        assetId: "a-2",
        code: "RECENT_CHECKIN_REPORT",
        severity: "critical",
        reportType: "LOST",
      }),
      expect.objectContaining({
        assetId: "a-1",
        code: "RECENT_CHECKIN_REPORT",
        severity: "warning",
        reportType: "DAMAGED",
      }),
    ]);
    expect(tx.checkinItemReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: { in: ["a-1", "a-2"] },
          createdAt: { gte: new Date("2026-03-03T12:00:00Z") },
        }),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkBulkTurnaroundRisks
// ═════════════════════════════════════════════════════════════════════════════
describe("checkBulkTurnaroundRisks", () => {
  it("flags tight future bulk commitments in the same location", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 7 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([
      {
        bulkSkuId: "sku-1",
        plannedQuantity: 6,
        bookingId: "b-next",
        booking: {
          title: "Next media booking",
          startsAt: new Date("2026-04-02T08:00:00Z"),
          locationId: "loc-1",
        },
      },
    ]);

    const result = await checkBulkTurnaroundRisks(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 2 }],
      endsAt: new Date("2026-04-01T22:00:00Z"),
    });

    expect(result).toEqual([{
      bulkSkuId: "sku-1",
      code: "BULK_SHORT_TURNAROUND",
      severity: "warning",
      message: "Next bulk booking needs 6 in 10h",
      bookingId: "b-next",
      bookingTitle: "Next media booking",
      startsAt: new Date("2026-04-02T08:00:00Z"),
      gapMinutes: 600,
      plannedQuantity: 6,
    }]);
  });

  it("does not warn when on-hand stock covers this checkout and the next booking", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 8 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([
      {
        bulkSkuId: "sku-1",
        plannedQuantity: 6,
        bookingId: "b-next",
        booking: {
          title: "Next media booking",
          startsAt: new Date("2026-04-02T08:00:00Z"),
          locationId: "loc-1",
        },
      },
    ]);

    const result = await checkBulkTurnaroundRisks(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 2 }],
      endsAt: new Date("2026-04-01T22:00:00Z"),
    });

    expect(result).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkAssetStatuses
// ═════════════════════════════════════════════════════════════════════════════
describe("checkAssetStatuses", () => {
  it("returns empty for no asset IDs", async () => {
    const tx = createMockTx();
    const result = await checkAssetStatuses(availabilityTx(tx), { serializedAssetIds: [] });
    expect(result).toEqual([]);
  });

  it("flags assets in MAINTENANCE status", async () => {
    const tx = createMockTx();
    tx.asset.findMany.mockResolvedValue([
      { id: "a-1", status: "MAINTENANCE", availableForCheckout: true, availableForReservation: true },
    ]);

    const result = await checkAssetStatuses(availabilityTx(tx), { serializedAssetIds: ["a-1"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ assetId: "a-1", status: "MAINTENANCE" });
  });

  it("flags missing assets as NOT_FOUND", async () => {
    const tx = createMockTx();
    tx.asset.findMany.mockResolvedValue([]);

    const result = await checkAssetStatuses(availabilityTx(tx), { serializedAssetIds: ["a-missing"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ assetId: "a-missing", status: "NOT_FOUND" });
  });

  it("flags assets not available for checkout", async () => {
    const tx = createMockTx();
    tx.asset.findMany.mockResolvedValue([
      { id: "a-1", status: "AVAILABLE", availableForCheckout: false, availableForReservation: true },
    ]);

    const result = await checkAssetStatuses(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      bookingKind: "CHECKOUT",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("NOT_AVAILABLE_FOR_CHECKOUT");
  });

  it("flags assets not available for reservation", async () => {
    const tx = createMockTx();
    tx.asset.findMany.mockResolvedValue([
      { id: "a-1", status: "AVAILABLE", availableForCheckout: true, availableForReservation: false },
    ]);

    const result = await checkAssetStatuses(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      bookingKind: "RESERVATION",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("NOT_AVAILABLE_FOR_RESERVATION");
  });

  it("passes AVAILABLE assets with correct flags", async () => {
    const tx = createMockTx();
    tx.asset.findMany.mockResolvedValue([
      { id: "a-1", status: "AVAILABLE", availableForCheckout: true, availableForReservation: true },
    ]);

    const result = await checkAssetStatuses(availabilityTx(tx), {
      serializedAssetIds: ["a-1"],
      bookingKind: "CHECKOUT",
    });
    expect(result).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkBulkShortages
// ═════════════════════════════════════════════════════════════════════════════
describe("checkBulkShortages", () => {
  it("returns empty for no bulk items", async () => {
    const tx = createMockTx();
    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });
    expect(result).toEqual([]);
  });

  it("detects shortage when requested > available", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 3 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 5 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ bulkSkuId: "sku-1", requested: 5, available: 3 });
  });

  it("treats missing balance as 0 available", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([]);
    tx.bookingBulkItem.findMany.mockResolvedValue([]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-missing", quantity: 1 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.available).toBe(0);
  });

  it("returns empty when sufficient stock", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 100 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 50 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });
    expect(result).toEqual([]);
  });

  it("subtracts overlapping booked reservation commitments from bulk availability", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 10 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", plannedQuantity: 7, checkedOutQuantity: 0 },
    ]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 4 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });

    expect(result).toEqual([{ bulkSkuId: "sku-1", requested: 4, available: 3 }]);
    expect(tx.bookingBulkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          booking: expect.objectContaining({
            status: { in: ["BOOKED"] },
            locationId: "loc-1",
            startsAt: { lt: new Date("2026-04-01T17:00:00Z") },
            endsAt: { gt: new Date("2026-04-01T08:00:00Z") },
          }),
        }),
      }),
    );
  });

  it("subtracts only the remaining quantity from a partially picked reservation", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 10 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", plannedQuantity: 7, checkedOutQuantity: 4 },
    ]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 6 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T17:00:00Z"),
    });

    expect(result).toEqual([]);
  });

  it("does not subtract adjacent bulk reservation commitments", async () => {
    const tx = createMockTx();
    tx.bulkStockBalance.findMany.mockResolvedValue([
      { bulkSkuId: "sku-1", onHandQuantity: 10 },
    ]);
    tx.bookingBulkItem.findMany.mockResolvedValue([]);

    const result = await checkBulkShortages(availabilityTx(tx), {
      locationId: "loc-1",
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 10 }],
      startsAt: new Date("2026-04-01T08:00:00Z"),
      endsAt: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result).toEqual([]);
    expect(tx.bookingBulkItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          booking: expect.objectContaining({
            startsAt: { lt: new Date("2026-04-01T12:00:00Z") },
            endsAt: { gt: new Date("2026-04-01T08:00:00Z") },
          }),
        }),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// checkAvailability (integration of sub-checks)
// ═════════════════════════════════════════════════════════════════════════════
describe("checkAvailability", () => {
  it("returns combined results from all sub-checks", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([]);
    tx.bulkStockBalance.findMany.mockResolvedValue([]);
    tx.bookingBulkItem.findMany.mockResolvedValue([]);
    tx.checkinItemReport.findMany.mockResolvedValue([]);
    tx.asset.findMany.mockResolvedValue([]);

    const result = await checkAvailability(availabilityTx(tx), {
      locationId: "loc-1",
      startsAt: new Date("2026-04-01"),
      endsAt: new Date("2026-04-02"),
      serializedAssetIds: [],
      bulkItems: [],
    });

    expect(result).toEqual({
      conflicts: [],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });
  });

  it("includes capacity-aware bulk turnaround advisories for exact kiosk units", async () => {
    const tx = createMockTx();
    tx.assetAllocation.findMany.mockResolvedValue([]);
    tx.bulkStockBalance.findMany.mockResolvedValue([{ bulkSkuId: "sku-1", onHandQuantity: 7 }]);
    tx.bookingBulkItem.findMany.mockResolvedValue([{
      bulkSkuId: "sku-1",
      plannedQuantity: 6,
      bookingId: "b-next",
      booking: {
        title: "Next kiosk booking",
        startsAt: new Date("2026-04-02T08:00:00Z"),
        locationId: "loc-1",
      },
    }]);
    tx.checkinItemReport.findMany.mockResolvedValue([]);
    tx.asset.findMany.mockResolvedValue([]);

    const result = await checkAvailability(availabilityTx(tx), {
      locationId: "loc-1",
      startsAt: new Date("2026-04-01"),
      endsAt: new Date("2026-04-02"),
      serializedAssetIds: [],
      bulkItems: [{ bulkSkuId: "sku-1", quantity: 2 }],
    });

    expect(result.bulkTurnaroundRisks).toEqual([expect.objectContaining({
      bulkSkuId: "sku-1",
      bookingId: "b-next",
      plannedQuantity: 6,
    })]);
    expect(tx.bookingBulkItem.findMany).toHaveBeenCalled();
  });
});
