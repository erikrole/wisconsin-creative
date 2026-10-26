import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    bulkSkuUnit: { findMany: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
  };
  return {
    tx,
    createBooking: vi.fn(),
    releaseAssignment: vi.fn(),
    notifyRemoved: vi.fn(),
    lookupActorRole: vi.fn(),
    createAuditEntryTx: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    ...mocks.tx,
    $transaction: vi.fn(async (fn: (client: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx)),
  },
}));
vi.mock("@/lib/services/booking-create", () => ({ createBooking: mocks.createBooking }));
vi.mock("@/lib/services/reservation-schedule", () => ({
  reconcileReservationScheduleTx: vi.fn(),
  releaseReservationManagedAssignmentTx: mocks.releaseAssignment,
}));
vi.mock("@/lib/services/notifications", () => ({
  createShiftScheduleNotification: mocks.notifyRemoved,
  dispatchScheduleAssignmentNotifications: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  lookupActorRole: mocks.lookupActorRole,
  createAuditEntryTx: mocks.createAuditEntryTx,
  createAuditEntriesTx: vi.fn(),
}));

import { cancelReservation, forceCheckoutReservation } from "@/lib/services/reservation-lifecycle";
import { buildDerivedBulkUnitQrValue } from "@/lib/bulk-unit-qr";

const future = new Date(Date.now() + 6 * 60 * 60 * 1000);
const reason = "Kiosk scanner offline, handed over in person";

const batteries = { id: "sku-batt", name: "Batteries", trackByNumber: true, binQrCodeValue: "BATT" };
const tape = { id: "sku-tape", name: "Gaffer tape", trackByNumber: false, binQrCodeValue: "TAPE" };

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    kind: BookingKind.RESERVATION,
    status: BookingStatus.BOOKED,
    custodyScope: "PERSON",
    title: "Volleyball vs Nebraska",
    requesterUserId: "student-1",
    locationId: "loc-1",
    startsAt: new Date(Date.now() - 60 * 60 * 1000),
    endsAt: future,
    notes: null,
    eventId: "event-1",
    sportCode: "VB",
    shiftAssignmentId: null,
    kitId: null,
    serializedItems: [
      { assetId: "cam-1", allocationStatus: "active" },
      { assetId: "cam-2", allocationStatus: "picked_up" },
    ],
    bulkItems: [] as Array<Record<string, unknown>>,
    scanEvents: [] as Array<Record<string, unknown>>,
    events: [] as Array<{ eventId: string }>,
    ...overrides,
  };
}

function bulkLine(sku: typeof batteries, plannedQuantity: number, checkedOutQuantity: number | null = 0) {
  return { bulkSkuId: sku.id, plannedQuantity, checkedOutQuantity, bulkSku: sku };
}

function units(skuId: string, numbers: number[]) {
  return numbers.map((unitNumber) => ({ bulkSkuId: skuId, unitNumber }));
}

function createdCheckout() {
  return mocks.createBooking.mock.calls[0]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.booking.findUnique.mockResolvedValue(reservation());
  mocks.tx.booking.update.mockResolvedValue({});
  mocks.tx.bulkSkuUnit.findMany.mockResolvedValue([]);
  mocks.tx.assetAllocation.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.scanSession.updateMany.mockResolvedValue({ count: 0 });
  mocks.createBooking.mockResolvedValue({ id: "checkout-1" });
  mocks.releaseAssignment.mockResolvedValue({ assignmentId: null, eventId: null, released: false, blocked: false });
  mocks.lookupActorRole.mockResolvedValue("STAFF");
  mocks.createAuditEntryTx.mockResolvedValue(undefined);
  mocks.notifyRemoved.mockResolvedValue(undefined);
});

describe("forceCheckoutReservation", () => {
  it("requires a real reason", async () => {
    await expect(forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason: "  offline  " }))
      .rejects.toMatchObject({ status: 400, message: "Reason must be at least 10 characters" });
    await expect(forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason: "x".repeat(1001) }))
      .rejects.toMatchObject({ status: 400, message: "Reason must be at most 1000 characters" });
    expect(mocks.tx.booking.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing booking", null, 404, "Reservation not found"],
    ["a checkout", reservation({ kind: BookingKind.CHECKOUT }), 404, "Reservation not found"],
    ["a cancelled reservation", reservation({ status: BookingStatus.CANCELLED }), 400, "Reservation is not in BOOKED status (current: CANCELLED)"],
    ["a reservation whose window has ended", reservation({ endsAt: new Date(Date.now() - 1000) }), 400, "Reservation end time has passed; extend it before force checkout"],
    ["a reservation with nothing left", reservation({ serializedItems: [{ assetId: "cam-2", allocationStatus: "picked_up" }] }), 409, "This reservation has no remaining items to force checkout"],
  ])("refuses %s", async (_label, source, status, message) => {
    mocks.tx.booking.findUnique.mockResolvedValue(source);

    await expect(forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason }))
      .rejects.toMatchObject({ status, message });
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("checks out only the gear still on the shelf, as an admin override", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue(reservation({
      bulkItems: [bulkLine(tape, 5, 2), bulkLine({ ...tape, id: "sku-done" }, 1, 1)],
    }));

    await forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason: `  ${reason}  ` });

    expect(createdCheckout()).toEqual(expect.objectContaining({
      kind: BookingKind.CHECKOUT,
      custodySource: "ADMIN_OVERRIDE",
      adminOverrideReason: reason,
      sourceReservationId: "res-1",
      sourceReservationPickup: true,
      createdBy: "admin-1",
      endsAt: future,
      serializedAssetIds: ["cam-1"],
      bulkItems: [{ bulkSkuId: "sku-tape", quantity: 3 }],
      bulkUnitItems: [],
      eventId: "event-1",
      eventIds: undefined,
    }));
    expect(mocks.tx.bulkSkuUnit.findMany).not.toHaveBeenCalled();
  });

  it("carries every linked event when the reservation has more than one", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue(reservation({ events: [{ eventId: "event-1" }, { eventId: "event-2" }] }));

    await forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason });

    expect(createdCheckout()).toEqual(expect.objectContaining({ eventIds: ["event-1", "event-2"], eventId: undefined }));
  });

  it("prefers numbered units already scanned at the kiosk, then fills from the lowest free numbers", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue(reservation({
      serializedItems: [],
      bulkItems: [bulkLine(batteries, 3, null)],
      scanEvents: [
        { bulkSkuId: batteries.id, scanValue: buildDerivedBulkUnitQrValue("BATT", 7) },
        { bulkSkuId: batteries.id, scanValue: buildDerivedBulkUnitQrValue("BATT", 7) },
        // Staged unit 9 has since been claimed elsewhere, so it is skipped.
        { bulkSkuId: batteries.id, scanValue: buildDerivedBulkUnitQrValue("BATT", 9) },
        { bulkSkuId: batteries.id, scanValue: "not-a-unit" },
        { bulkSkuId: null, scanValue: buildDerivedBulkUnitQrValue("BATT", 4) },
      ],
    }));
    mocks.tx.bulkSkuUnit.findMany.mockResolvedValue(units(batteries.id, [2, 3, 5, 7]));

    await forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason });

    expect(mocks.tx.bulkSkuUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bulkSkuId: { in: [batteries.id] } }),
    }));
    expect(createdCheckout().bulkUnitItems).toEqual([
      { bulkSkuId: batteries.id, unitNumber: 7 },
      { bulkSkuId: batteries.id, unitNumber: 2 },
      { bulkSkuId: batteries.id, unitNumber: 3 },
    ]);
    expect(createdCheckout().bulkItems).toEqual([{ bulkSkuId: batteries.id, quantity: 3 }]);
  });

  it("refuses when not enough numbered units are free", async () => {
    mocks.tx.booking.findUnique.mockResolvedValue(reservation({
      serializedItems: [],
      bulkItems: [bulkLine(batteries, 4, 1)],
    }));
    mocks.tx.bulkSkuUnit.findMany.mockResolvedValue(units(batteries.id, [1, 2]));

    await expect(forceCheckoutReservation({ reservationId: "res-1", actorUserId: "admin-1", reason }))
      .rejects.toMatchObject({
        status: 409,
        message: "Batteries: 3 numbered units are required, but only 2 are available for force checkout",
      });
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });
});

describe("cancelReservation", () => {
  beforeEach(() => {
    mocks.tx.booking.findUnique.mockResolvedValue({
      id: "res-1",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      shiftAssignmentId: "assignment-1",
    });
  });

  it("releases the shift the reservation created and tells the worker", async () => {
    mocks.releaseAssignment.mockResolvedValue({ assignmentId: "assignment-1", eventId: "event-1", released: true, blocked: false });

    const result = await cancelReservation("res-1", "staff-1");

    expect(result).toEqual({ success: true, scheduleAssignmentReleased: true });
    expect(mocks.releaseAssignment).toHaveBeenCalledWith(mocks.tx, { bookingId: "res-1", assignmentId: "assignment-1" });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      entityType: "shift_assignment",
      entityId: "assignment-1",
      action: "shift_assignment_removed",
      after: { reason: "reservation_cancelled" },
    }));
    expect(mocks.notifyRemoved).toHaveBeenCalledWith("assignment-1", "removed");
  });

  it("flags the schedule for review when an open draft blocks the release", async () => {
    mocks.releaseAssignment.mockResolvedValue({ assignmentId: "assignment-1", eventId: "event-1", released: false, blocked: true });

    const result = await cancelReservation("res-1", "staff-1");

    expect(result.scheduleAssignmentReleased).toBe(false);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      entityType: "booking",
      action: "schedule_assignment_review_needed",
      after: expect.objectContaining({ status: "blocked_working_copy" }),
    }));
    expect(mocks.notifyRemoved).not.toHaveBeenCalled();
    expect(mocks.tx.booking.update).toHaveBeenCalledWith({ where: { id: "res-1" }, data: { status: BookingStatus.CANCELLED } });
  });

  it("cancels without touching the schedule when no shift is linked", async () => {
    const result = await cancelReservation("res-1", "staff-1");

    expect(result.scheduleAssignmentReleased).toBe(false);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledTimes(1);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "cancelled" }));
  });

  it("refuses a missing booking or a checkout", async () => {
    mocks.tx.booking.findUnique.mockResolvedValueOnce(null);
    await expect(cancelReservation("res-1", "staff-1")).rejects.toMatchObject({ status: 404 });

    mocks.tx.booking.findUnique.mockResolvedValueOnce({ id: "co-1", kind: BookingKind.CHECKOUT, status: BookingStatus.OPEN });
    await expect(cancelReservation("co-1", "staff-1")).rejects.toMatchObject({ status: 400, message: "Only reservations can be cancelled" });

    expect(mocks.tx.booking.update).not.toHaveBeenCalled();
  });
});
