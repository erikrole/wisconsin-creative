import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const transactionCalls: Array<{ options: unknown }> = [];

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  bookingUpdateMany: vi.fn(),
  serializedDeleteMany: vi.fn(),
  allocationUpdateMany: vi.fn(),
  bulkUpdate: vi.fn(),
  bulkDelete: vi.fn(),
  bulkDeleteMany: vi.fn(),
  scanSessionUpdateMany: vi.fn(),
  lookupActorRole: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    booking: {
      findUnique: mocks.findUnique,
      updateMany: mocks.bookingUpdateMany,
    },
    bookingSerializedItem: { deleteMany: mocks.serializedDeleteMany },
    bookingBulkItem: { update: mocks.bulkUpdate, delete: mocks.bulkDelete, deleteMany: mocks.bulkDeleteMany },
    assetAllocation: { updateMany: mocks.allocationUpdateMany },
    scanSession: { updateMany: mocks.scanSessionUpdateMany },
  };
  return {
    db: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(tx);
      }),
    },
  };
});

vi.mock("@/lib/audit", () => ({
  lookupActorRole: mocks.lookupActorRole,
  createAuditEntryTx: mocks.createAuditEntryTx,
}));

import { db } from "@/lib/db";
import { closeReservationRemaining, detachRolledReservationPlan } from "@/lib/services/bookings-lifecycle";

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mocks.lookupActorRole.mockResolvedValue("STAFF");
  mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.serializedDeleteMany.mockResolvedValue({ count: 1 });
  mocks.allocationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.scanSessionUpdateMany.mockResolvedValue({ count: 0 });
  mocks.createAuditEntryTx.mockResolvedValue({ id: "audit-1" });
});

describe("closeReservationRemaining", () => {
  it("releases leftover holds and completes a partially picked-up reservation", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      refNumber: "RV-0453",
      serializedItems: [
        { assetId: "fx3", allocationStatus: "picked_up", asset: { assetTag: "FX3 2", name: "FX3 2" } },
        { assetId: "535", allocationStatus: "active", asset: { assetTag: "Manfrotto 535 MPro Tripod", name: "Manfrotto 535 MPro Tripod" } },
      ],
      bulkItems: [],
      derivedCheckouts: [{ id: "co-1", refNumber: "CO-0454" }],
    });

    const result = await closeReservationRemaining({
      reservationId: "rv-1",
      actorUserId: "staff-1",
      reason: "Grabbed the 755CX3 instead of the reserved 535.",
    });

    expect(result.status).toBe(BookingStatus.COMPLETED);
    expect(result.releasedSerialized).toEqual([
      { assetId: "535", name: "Manfrotto 535 MPro Tripod" },
    ]);
    expect(mocks.serializedDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: "rv-1" },
    });
    expect(mocks.bulkDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: "rv-1" },
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "reservation_closed_remaining_released",
    }));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expectSerializableIsolation(transactionCalls);
  });

  it("refuses to close a reservation that has not started pickup", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "rv-2",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      refNumber: "RV-0001",
      serializedItems: [
        { assetId: "fx3", allocationStatus: "active", asset: { assetTag: "FX3 2", name: "FX3 2" } },
      ],
      bulkItems: [],
      derivedCheckouts: [],
    });

    await expect(closeReservationRemaining({
      reservationId: "rv-2",
      actorUserId: "staff-1",
    })).rejects.toThrow("Nothing from this reservation has been picked up yet");
    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it("moves picked reservation lines off the completed plan onto the linked checkout", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "rv-1",
      kind: BookingKind.RESERVATION,
      status: BookingStatus.COMPLETED,
      refNumber: "RV-0453",
      serializedItems: [
        { assetId: "fx3", allocationStatus: "picked_up", asset: { assetTag: "FX3 2", name: "FX3 2" } },
      ],
      bulkItems: [
        { bulkSkuId: "sony", plannedQuantity: 3, checkedOutQuantity: 3, bulkSku: { name: "Sony Battery" } },
      ],
      derivedCheckouts: [{ id: "co-1", refNumber: "CO-0454", status: "COMPLETED" }],
    });

    const result = await detachRolledReservationPlan({
      reservationId: "rv-1",
      actorUserId: "staff-1",
      expectedRefNumber: "RV-0453",
    });

    expect(result.rolledSerialized).toHaveLength(1);
    expect(mocks.serializedDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: "rv-1", assetId: { in: ["fx3"] }, allocationStatus: "picked_up" },
    });
    expect(mocks.bulkDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: "rv-1", bulkSkuId: { in: ["sony"] } },
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "reservation_picked_items_moved_to_checkout",
    }));
  });
});
