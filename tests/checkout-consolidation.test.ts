import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingCustodyScope, BookingKind, BookingStatus, Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { checkAvailability } from "@/lib/services/availability";
import { mergeCheckouts, previewCheckoutMerge } from "@/lib/services/checkout-consolidation";

const ids = ["cm000000000000000000000001", "cm000000000000000000000002"];
const eventId = "cm000000000000000000000003";
const requesterId = "cm000000000000000000000004";
const locationId = "cm000000000000000000000005";
const batterySkuId = "cm000000000000000000000006";
const reservationA = "cm000000000000000000000009";
const reservationB = "cm000000000000000000000010";

function checkout(id: string, overrides: Record<string, unknown> = {}) {
  const assetId = `${id}-asset`;
  const unitId = `${id}-unit`;
  const bulkItemId = `${id}-bulk-item`;
  return {
    id,
    kind: BookingKind.CHECKOUT,
    status: BookingStatus.OPEN,
    title: "Volleyball Photo",
    requesterUserId: requesterId,
    locationId,
    startsAt: new Date("2026-09-04T15:00:00.000Z"),
    endsAt: new Date("2026-09-05T04:00:00.000Z"),
    createdAt: new Date(id === ids[0] ? "2026-09-04T10:00:00.000Z" : "2026-09-04T10:05:00.000Z"),
    refNumber: id === ids[0] ? "CO-1001" : "CO-1002",
    notes: null,
    sourceReservationId: null,
    eventId,
    custodyScope: BookingCustodyScope.PERSON,
    events: [{ eventId }],
    serializedItems: [{ id: `${id}-serialized-item`, assetId, allocationStatus: "active" }],
    allocations: [{ assetId }],
    bulkItems: [{
      id: bulkItemId,
      bulkSkuId: batterySkuId,
      plannedQuantity: id === ids[0] ? 1 : 2,
      checkedOutQuantity: id === ids[0] ? 1 : 2,
      checkedInQuantity: 0,
      unitAllocations: [{
        id: `${id}-unit-allocation`,
        bulkSkuUnitId: unitId,
        checkedOutAt: new Date("2026-09-04T15:01:00.000Z"),
        checkedInAt: null,
      }],
    }],
    accountabilityExclusion: null,
    ...overrides,
  };
}

function transactionClient() {
  return {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    bookingSerializedItem: { updateMany: vi.fn() },
    assetAllocation: { updateMany: vi.fn() },
    bookingBulkUnitAllocation: { updateMany: vi.fn() },
    bookingBulkItem: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    scanEvent: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    overrideEvent: { updateMany: vi.fn() },
    bulkStockMovement: { updateMany: vi.fn() },
    bookingPhoto: { updateMany: vi.fn() },
    checkinItemReport: { updateMany: vi.fn() },
    liveActivityToken: { updateMany: vi.fn() },
    bookingDueDateChange: { updateMany: vi.fn(), create: vi.fn() },
    liveActivityStart: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAvailability).mockResolvedValue({
    conflicts: [],
    shortages: [],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  });
});

describe("checkout consolidation", () => {
  it("previews an older event checkout with additive battery totals", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[1]!, { startsAt: new Date("2026-09-04T15:07:00.000Z") }),
      checkout(ids[0]!),
    ] as never);

    await expect(previewCheckoutMerge(ids)).resolves.toMatchObject({
      targetCheckoutId: ids[0],
      sourceCheckoutIds: [ids[1]],
      title: "Volleyball Photo",
      requesterUserId: requesterId,
      custodyScope: BookingCustodyScope.PERSON,
      eventIds: [eventId],
      serializedItemCount: 2,
      bulkQuantity: 3,
      targetCheckout: {
        id: ids[0],
        refNumber: "CO-1001",
        startsAt: "2026-09-04T15:00:00.000Z",
        latestPickupAt: "2026-09-04T15:07:00.000Z",
        endsAt: "2026-09-05T04:00:00.000Z",
        sourceReservationId: null,
      },
      returnWindowOptions: [{
        endsAt: "2026-09-05T04:00:00.000Z",
        checkoutIds: ids,
        checkoutRefs: ["CO-1001", "CO-1002"],
      }],
      sourceReservationOptions: [{
        sourceReservationId: null,
        checkoutIds: ids,
        checkoutRefs: ["CO-1001", "CO-1002"],
      }],
      conflicts: { returnWindow: false, sourceReservation: false },
    });
  });

  it("previews return and reservation conflicts for the explicit merge modal", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[0]!, { sourceReservationId: reservationA }),
      checkout(ids[1]!, {
        endsAt: new Date("2026-09-05T05:00:00.000Z"),
        sourceReservationId: reservationB,
      }),
    ] as never);

    const preview = await previewCheckoutMerge(ids, { allowContextOverrides: true });

    expect(preview.conflicts).toEqual({ returnWindow: true, sourceReservation: true });
    expect(preview.returnWindowOptions).toHaveLength(2);
    expect(preview.sourceReservationOptions).toEqual([
      { sourceReservationId: reservationA, checkoutIds: [ids[0]], checkoutRefs: ["CO-1001"] },
      { sourceReservationId: reservationB, checkoutIds: [ids[1]], checkoutRefs: ["CO-1002"] },
    ]);
  });

  it("rejects a returned checkout or a different event context", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[0]!),
      checkout(ids[1]!, {
        eventId: "cm000000000000000000000007",
        events: [{ eventId: "cm000000000000000000000007" }],
        bulkItems: [],
      }),
    ] as never);

    await expect(previewCheckoutMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a checkout after any item has been returned", async () => {
    const returned = checkout(ids[1]!);
    returned.serializedItems[0]!.allocationStatus = "returned";
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[0]!),
      returned,
    ] as never);

    await expect(previewCheckoutMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a checkout with bulk custody that is not fully picked up", async () => {
    const staged = checkout(ids[1]!);
    staged.bulkItems[0]!.checkedOutQuantity = 1;
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[0]!),
      staged,
    ] as never);

    await expect(previewCheckoutMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("still requires the return windows to match", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      checkout(ids[0]!),
      checkout(ids[1]!, { endsAt: new Date("2026-09-05T05:00:00.000Z") }),
    ] as never);

    await expect(previewCheckoutMerge(ids)).rejects.toMatchObject({ status: 409 });
  });

  it("moves custody-linked rows and cancels only the emptied source checkout", async () => {
    const tx = transactionClient();
    const canonical = checkout(ids[0]!);
    const source = checkout(ids[1]!);
    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      tx.booking.findMany.mockResolvedValue([source, canonical]);
      tx.booking.findUniqueOrThrow.mockResolvedValue({ id: canonical.id, status: BookingStatus.OPEN } as never);
      return callback(tx as never);
    });

    await mergeCheckouts({
      ids,
      actorUserId: "cm000000000000000000000008",
      actorRole: Role.STAFF,
    });

    expect(tx.bookingSerializedItem.updateMany).toHaveBeenCalledWith({
      where: { bookingId: { in: [ids[1]] } },
      data: { bookingId: ids[0] },
    });
    expect(tx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: { in: [ids[1]] }, active: true },
      data: { bookingId: ids[0] },
    });
    expect(tx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingBulkItemId: `${ids[1]}-bulk-item` },
      data: { bookingBulkItemId: `${ids[0]}-bulk-item` },
    });
    expect(tx.bulkStockMovement.updateMany).toHaveBeenCalledWith({
      where: { bookingId: { in: [ids[1]] } },
      data: { bookingId: ids[0] },
    });
    expect(tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids[1] },
      data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
    }));
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: ids[0] },
      data: { notes: null },
    });
    expect(tx.bookingBulkItem.delete).toHaveBeenCalledWith({
      where: { id: `${ids[1]}-bulk-item` },
    });
  });

  it("applies an explicit return and reservation choice with due-date audit history", async () => {
    const tx = transactionClient();
    const canonical = checkout(ids[0]!, { sourceReservationId: reservationA });
    const source = checkout(ids[1]!, {
      endsAt: new Date("2026-09-05T05:00:00.000Z"),
      sourceReservationId: reservationB,
    });
    const selectedEndsAt = new Date("2026-09-05T06:00:00.000Z");
    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      tx.booking.findMany.mockResolvedValue([source, canonical]);
      tx.booking.findUniqueOrThrow.mockResolvedValue({ id: canonical.id, status: BookingStatus.OPEN } as never);
      return callback(tx as never);
    });

    await mergeCheckouts({
      ids,
      actorUserId: "cm000000000000000000000008",
      actorRole: Role.STAFF,
      allowContextOverrides: true,
      endsAt: selectedEndsAt,
      sourceReservationId: reservationB,
    });

    expect(checkAvailability).toHaveBeenCalledWith(tx, expect.objectContaining({
      endsAt: selectedEndsAt,
      excludeBookingId: ids[0],
      bookingKind: BookingKind.CHECKOUT,
      enforceSerializedTurnaroundBuffer: false,
    }));
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: ids[0] },
      data: expect.objectContaining({
        notes: null,
        endsAt: selectedEndsAt,
        sourceReservationId: reservationB,
      }),
    });
    expect(tx.assetAllocation.updateMany).toHaveBeenCalledWith({
      where: { bookingId: ids[0], active: true },
      data: { endsAt: selectedEndsAt },
    });
    expect(tx.bookingDueDateChange.create).toHaveBeenCalledWith({
      data: {
        bookingId: ids[0],
        actorUserId: "cm000000000000000000000008",
        previousEndsAt: canonical.endsAt,
        nextEndsAt: selectedEndsAt,
      },
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "checkouts_merged",
      after: expect.objectContaining({
        contextResolution: expect.objectContaining({
          selectedEndsAt: selectedEndsAt.toISOString(),
          selectedSourceReservationId: reservationB,
        }),
      }),
    }));
  });

  it("keeps merge repair staff-only", async () => {
    await expect(mergeCheckouts({
      ids,
      actorUserId: "cm000000000000000000000008",
      actorRole: Role.STUDENT,
    })).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
