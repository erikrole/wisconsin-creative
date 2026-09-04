import { describe, expect, it, vi } from "vitest";
import {
  scanKioskCheckinBulkUnit,
  scanKioskPickupBulkUnit,
  stageKioskReservationPickupBulkUnit,
} from "@/lib/services/bulk-unit-scans";

function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  const tx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    bulkSku: { findMany: vi.fn() },
    bulkSkuUnit: { findUnique: vi.fn(), update: vi.fn() },
    bookingBulkUnitAllocation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bookingBulkItem: { update: vi.fn(), findMany: vi.fn() },
    bookingSerializedItem: { count: vi.fn().mockResolvedValue(0) },
    assetAllocation: { updateMany: vi.fn() },
    bulkStockBalance: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
    bulkStockMovement: { createMany: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    scanSession: { updateMany: vi.fn() },
    scanEvent: { findMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn() },
    ...overrides,
  };
  return tx as typeof tx & Parameters<typeof scanKioskPickupBulkUnit>[0];
}

const pickupBooking = {
  id: "booking-1",
  kind: "CHECKOUT",
  status: "PENDING_PICKUP",
  bulkItems: [{
    id: "bulk-item-1",
    bulkSkuId: "sku-1",
    plannedQuantity: 5,
    checkedOutQuantity: 0,
    bulkSku: {
      id: "sku-1",
      name: "Sony Battery",
      category: "Batteries",
      binQrCodeValue: "94e068d1",
      trackByNumber: true,
    },
  }],
};

const reservationBooking = {
  ...pickupBooking,
  id: "reservation-1",
  kind: "RESERVATION",
  status: "BOOKED",
  requesterUserId: "user-1",
};

describe("scanKioskPickupBulkUnit", () => {
  it("binds one available numbered unit to a pending pickup", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({
        id: "bulk-item-1:slot:1",
        tagName: "#7",
        unitNumber: 7,
      }),
    }));
    expect(tx.bookingBulkUnitAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingBulkItemId: "bulk-item-1",
        bulkSkuUnitId: "unit-7",
      }),
    });
    expect(tx.bulkSkuUnit.update).toHaveBeenCalledWith({
      where: { id: "unit-7" },
      data: { status: "CHECKED_OUT" },
    });
    expect(tx.bookingBulkItem.update).toHaveBeenCalledWith({
      where: { id: "bulk-item-1" },
      data: { checkedOutQuantity: { increment: 1 } },
    });
  });

  it("binds numbered units when the hand scanner sends a wrapped QR value", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "https://gear.example/scan?qr_code=QR-94e068d1\u20117",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({
        tagName: "#7",
        unitNumber: 7,
      }),
    }));
  });

  it("returns duplicate feedback with the unit number", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue({
      id: "allocation-1",
      checkedOutAt: new Date(),
    });

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 already scanned",
      errorCode: "duplicate",
    });
  });

  it("explains when the scanned unit is the wrong battery type", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSku.findMany.mockResolvedValue([
      pickupBooking.bulkItems[0]!.bulkSku,
      {
        id: "sku-2",
        name: "Canon Battery",
        category: "Batteries",
        binQrCodeValue: "canon-battery",
        trackByNumber: true,
      },
    ]);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "canon-battery-4",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Wrong battery type: scanned Canon Battery #4, but this pickup expects Sony Battery",
      errorCode: "not_in_booking",
    });
  });

  it("explains when a pickup unit is already checked out elsewhere", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
      allocations: [{
        bookingBulkItem: {
          booking: {
            title: "Other checkout",
            requester: { name: "Bucky Badger" },
          },
        },
      }],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 is already checked out to Bucky Badger",
      errorCode: "already_checked_out",
    });
  });

  it("allows pickup when a raw checked-out unit has no active allocation", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
      allocations: [],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({ unitNumber: 7 }),
    }));
    expect(tx.bookingBulkUnitAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingBulkItemId: "bulk-item-1",
        bulkSkuUnitId: "unit-7",
      }),
    });
  });

  it("blocks pickup when the requested battery quantity is already fully scanned", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        plannedQuantity: 2,
        checkedOutQuantity: 2,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
      allocations: [],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery already has 2 of 2 units scanned",
      errorCode: "quantity_exceeded",
    });
    expect(tx.bookingBulkUnitAllocation.create).not.toHaveBeenCalled();
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });

  it("blocks pickup of missing or retired battery units with status-specific copy", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(pickupBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "LOST",
      allocations: [],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskPickupBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 is marked lost and cannot be picked up",
      errorCode: "wrong_status",
    });
    expect(tx.bookingBulkUnitAllocation.create).not.toHaveBeenCalled();
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });
});

describe("stageKioskReservationPickupBulkUnit", () => {
  it("stages a numbered unit scan on the reservation without checking it out", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(reservationBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
      allocations: [],
    });
    tx.scanEvent.findMany.mockResolvedValue([]);
    tx.scanEvent.create.mockResolvedValue({ id: "scan-1" });

    const result = await stageKioskReservationPickupBulkUnit(tx, {
      bookingId: "reservation-1",
      scanValue: "94e068d1-7",
      deviceContext: "vitest-kiosk",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({
        id: "bulk-item-1:slot:1",
        tagName: "#7",
        unitNumber: 7,
      }),
    }));
    expect(tx.scanEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "reservation-1",
        actorUserId: "user-1",
        scanType: "BULK_BIN",
        scanValue: "94e068d1-7",
        success: true,
        phase: "CHECKOUT",
        bulkSkuId: "sku-1",
        quantity: 1,
        deviceContext: "vitest-kiosk",
      }),
    });
    expect(tx.bookingBulkUnitAllocation.create).not.toHaveBeenCalled();
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
    expect(tx.bookingBulkItem.update).not.toHaveBeenCalled();
  });

  it("stages a raw checked-out unit when there is no active allocation", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(reservationBooking);
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
      allocations: [],
    });
    tx.scanEvent.findMany.mockResolvedValue([]);
    tx.scanEvent.create.mockResolvedValue({ id: "scan-1" });

    const result = await stageKioskReservationPickupBulkUnit(tx, {
      bookingId: "reservation-1",
      scanValue: "94e068d1-7",
      deviceContext: "vitest-kiosk",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({ unitNumber: 7 }),
    }));
    expect(tx.scanEvent.create).toHaveBeenCalled();
  });

  it("does not restage a numbered unit already handed over in an earlier partial pickup", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...reservationBooking,
      bulkItems: [{
        ...reservationBooking.bulkItems[0],
        plannedQuantity: 3,
        checkedOutQuantity: 1,
      }],
      derivedCheckouts: [{
        bulkItems: [{
          bulkSkuId: "sku-1",
          unitAllocations: [{
            bulkSkuUnitId: "unit-7",
            bulkSkuUnit: { unitNumber: 7 },
          }],
        }],
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
      allocations: [],
    });

    const result = await stageKioskReservationPickupBulkUnit(tx, {
      bookingId: "reservation-1",
      scanValue: "94e068d1-7",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 already picked up",
      errorCode: "duplicate",
    });
    expect(tx.scanEvent.findMany).not.toHaveBeenCalled();
    expect(tx.scanEvent.create).not.toHaveBeenCalled();
  });
});

describe("scanKioskCheckinBulkUnit", () => {
  it("returns only the scanned numbered unit", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      locationId: "loc-1",
      requesterUserId: "user-1",
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 5,
        checkedInQuantity: 0,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue({
      id: "allocation-1",
      checkedOutAt: new Date(),
      checkedInAt: null,
    });
    // Four of five units are still outstanding — maybeAutoComplete must not complete the booking.
    tx.bookingBulkItem.findMany.mockResolvedValue([
      { checkedInQuantity: 1, checkedOutQuantity: 5, plannedQuantity: 5 },
    ]);

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      item: expect.objectContaining({ tagName: "#7", unitNumber: 7 }),
      completed: false,
      badgeEvent: null,
    }));
    expect(tx.bookingBulkUnitAllocation.update).toHaveBeenCalledWith({
      where: { id: "allocation-1" },
      data: expect.objectContaining({ checkedInAt: expect.any(Date) }),
    });
    // The unit is physically back — the ledger restock happens at the scan,
    // not at completion (one movement per checkedInQuantity increment).
    expect(tx.bulkStockMovement.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ bulkSkuId: "sku-1", kind: "CHECKIN", quantity: 1, locationId: "loc-return" })],
    });
    expect(tx.bulkSkuUnit.update).toHaveBeenCalledWith({
      where: { id: "unit-7" },
      data: { status: "AVAILABLE" },
    });
    expect(tx.bookingBulkItem.update).toHaveBeenCalledWith({
      where: { id: "bulk-item-1" },
      data: { checkedInQuantity: { increment: 1 } },
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("auto-completes the checkout when this scan returns the last outstanding battery", async () => {
    // Regression: a dropped kiosk session between the last battery scan and
    // the explicit "Complete Return" tap must not leave the booking stuck
    // OPEN once every item shows returned — mirrors kioskCheckinAsset.
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      locationId: "loc-1",
      requesterUserId: "user-1",
      custodyScope: "PERSON",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 1,
        checkedInQuantity: 0,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue({
      id: "allocation-1",
      checkedOutAt: new Date(),
      checkedInAt: null,
    });
    // Fresh read inside maybeAutoComplete sees the just-incremented quantity: fully returned.
    tx.bookingBulkItem.findMany.mockResolvedValue([
      { checkedInQuantity: 1, checkedOutQuantity: 1, plannedQuantity: 1 },
    ]);

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      success: true,
      completed: true,
      badgeEvent: expect.objectContaining({
        userId: "user-1",
        bookingId: "booking-1",
        completedAt: expect.any(Date),
        wasOnTime: expect.any(Boolean),
        sourceKey: "booking-1",
      }),
    }));
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(tx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1", active: true },
      data: { active: false },
    });
    expect(tx.scanSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bookingId: "booking-1", phase: "CHECKIN", status: "OPEN" }),
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user-1",
        entityType: "booking",
        entityId: "booking-1",
        action: "auto_completed_by_kiosk_checkin",
      }),
    });
  });

  it("explains when a return unit belongs to a different battery SKU", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 5,
        checkedInQuantity: 0,
      }],
    });
    tx.bulkSku.findMany.mockResolvedValue([
      pickupBooking.bulkItems[0]!.bulkSku,
      {
        id: "sku-2",
        name: "Canon Battery",
        category: "Batteries",
        binQrCodeValue: "canon-battery",
        trackByNumber: true,
      },
    ]);

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "canon-battery-4",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Wrong battery type: scanned Canon Battery #4, but this return expects Sony Battery",
      errorCode: "not_in_booking",
    });
  });

  it("explains when a return unit is checked out on another booking", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 5,
        checkedInQuantity: 0,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "CHECKED_OUT",
      allocations: [{
        bookingBulkItem: {
          booking: {
            title: "Other checkout",
            requester: { name: "Bucky Badger" },
          },
        },
      }],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 is checked out on another booking to Bucky Badger",
      errorCode: "wrong_status",
    });
  });

  it("blocks return when the scanned unit was never checked out on this booking", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 5,
        checkedInQuantity: 0,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
      allocations: [],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue(null);

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 is not checked out on this booking",
      errorCode: "not_checked_out",
    });
    expect(tx.bookingBulkUnitAllocation.update).not.toHaveBeenCalled();
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });

  it("blocks return when a scanned unit was already returned", async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue({
      ...pickupBooking,
      status: "OPEN",
      bulkItems: [{
        ...pickupBooking.bulkItems[0],
        checkedOutQuantity: 5,
        checkedInQuantity: 1,
      }],
    });
    tx.bulkSkuUnit.findUnique.mockResolvedValue({
      id: "unit-7",
      bulkSkuId: "sku-1",
      unitNumber: 7,
      status: "AVAILABLE",
      allocations: [],
    });
    tx.bookingBulkUnitAllocation.findUnique.mockResolvedValue({
      id: "allocation-1",
      checkedOutAt: new Date(),
      checkedInAt: new Date(),
    });

    const result = await scanKioskCheckinBulkUnit(tx, {
      bookingId: "booking-1",
      scanValue: "94e068d1-7",
      kioskLocationId: "loc-return",
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      handled: true,
      success: false,
      error: "Sony Battery #7 already returned",
      errorCode: "already_returned",
    });
    expect(tx.bookingBulkUnitAllocation.update).not.toHaveBeenCalled();
    expect(tx.bulkSkuUnit.update).not.toHaveBeenCalled();
  });
});
