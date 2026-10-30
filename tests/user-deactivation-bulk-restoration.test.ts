import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    booking: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    assetAllocation: { updateMany: vi.fn() },
    bulkStockBalance: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    bulkStockMovement: { createMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    apiToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    session: { deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    liveActivityStartToken: { updateMany: vi.fn() },
    liveActivityToken: { count: vi.fn() },
    liveActivityStart: { count: vi.fn() },
    user: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    tx,
    db: { $transaction: vi.fn() },
    createAuditEntryTx: vi.fn(),
    revokeCompanionUser: vi.fn(),
    refreshCompanionProjection: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.createAuditEntryTx,
}));
vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: mocks.revokeCompanionUser,
}));
vi.mock("@/lib/services/companion-projection", () => ({
  refreshCompanionProjection: mocks.refreshCompanionProjection,
}));

import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";

type TransactionCallback = (tx: typeof mocks.tx) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();

  mocks.db.$transaction.mockImplementation(
    async (callback: TransactionCallback) => callback(mocks.tx),
  );
  mocks.tx.booking.count.mockResolvedValue(0);
  mocks.tx.booking.updateMany.mockResolvedValue({ count: 4 });
  mocks.tx.assetAllocation.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.scanSession.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.session.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.liveActivityStartToken.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.liveActivityToken.count.mockResolvedValue(0);
  mocks.tx.liveActivityStart.count.mockResolvedValue(0);
  mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.user.update.mockResolvedValue({ id: "user-1", active: false });
  mocks.tx.bulkStockBalance.createMany.mockResolvedValue({ count: 1 });
  mocks.tx.bulkStockMovement.createMany.mockResolvedValue({ count: 4 });
  mocks.createAuditEntryTx.mockResolvedValue(undefined);
  mocks.revokeCompanionUser.mockResolvedValue(undefined);
  mocks.refreshCompanionProjection.mockResolvedValue({});
});

describe("user deactivation pending-pickup stock restoration", () => {
  it("batches balances while preserving one movement per booking and SKU", async () => {
    mocks.tx.booking.findMany.mockResolvedValue([
      {
        id: "booking-1",
        kind: "CHECKOUT",
        status: "PENDING_PICKUP",
        locationId: "loc-a",
        bulkItems: [
          { bulkSkuId: "sku-a", plannedQuantity: 2 },
          { bulkSkuId: "sku-b", plannedQuantity: 1 },
        ],
      },
      {
        id: "booking-2",
        kind: "CHECKOUT",
        status: "PENDING_PICKUP",
        locationId: "loc-a",
        bulkItems: [{ bulkSkuId: "sku-a", plannedQuantity: 3 }],
      },
      {
        id: "booking-3",
        kind: "CHECKOUT",
        status: "PENDING_PICKUP",
        locationId: "loc-b",
        bulkItems: [{ bulkSkuId: "sku-a", plannedQuantity: 4 }],
      },
      {
        id: "booking-4",
        kind: "RESERVATION",
        status: "BOOKED",
        locationId: "loc-a",
        bulkItems: [{ bulkSkuId: "sku-a", plannedQuantity: 100 }],
      },
    ]);
    mocks.tx.bulkStockBalance.findMany.mockResolvedValue([
      {
        bulkSkuId: "sku-a",
        locationId: "loc-a",
        onHandQuantity: 10,
      },
      {
        bulkSkuId: "sku-a",
        locationId: "loc-b",
        onHandQuantity: 7,
      },
    ]);
    mocks.tx.$executeRaw.mockResolvedValue(2);

    await deactivateUserWithCleanup({
      targetUserId: "user-1",
      actorId: "admin-1",
      actorRole: "ADMIN",
    });

    expect(mocks.tx.bulkStockBalance.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.bulkStockBalance.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { bulkSkuId: "sku-a", locationId: "loc-a" },
          { bulkSkuId: "sku-b", locationId: "loc-a" },
          { bulkSkuId: "sku-a", locationId: "loc-b" },
        ],
      },
      select: {
        bulkSkuId: true,
        locationId: true,
        onHandQuantity: true,
      },
    });
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(
      (mocks.tx.$executeRaw.mock.calls[0]![0] as { values: unknown[] }).values,
    ).toEqual([
      "sku-a",
      "loc-a",
      15,
      "sku-a",
      "loc-b",
      11,
    ]);
    expect(mocks.tx.bulkStockBalance.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.bulkStockBalance.createMany).toHaveBeenCalledWith({
      data: [
        {
          bulkSkuId: "sku-b",
          locationId: "loc-a",
          onHandQuantity: 1,
        },
      ],
    });
    expect(mocks.tx.bulkStockMovement.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.bulkStockMovement.createMany).toHaveBeenCalledWith({
      data: [
        {
          bulkSkuId: "sku-a",
          locationId: "loc-a",
          bookingId: "booking-1",
          actorUserId: "admin-1",
          kind: "CHECKIN",
          quantity: 2,
        },
        {
          bulkSkuId: "sku-b",
          locationId: "loc-a",
          bookingId: "booking-1",
          actorUserId: "admin-1",
          kind: "CHECKIN",
          quantity: 1,
        },
        {
          bulkSkuId: "sku-a",
          locationId: "loc-a",
          bookingId: "booking-2",
          actorUserId: "admin-1",
          kind: "CHECKIN",
          quantity: 3,
        },
        {
          bulkSkuId: "sku-a",
          locationId: "loc-b",
          bookingId: "booking-3",
          actorUserId: "admin-1",
          kind: "CHECKIN",
          quantity: 4,
        },
      ],
    });
    expect(mocks.refreshCompanionProjection).toHaveBeenCalledTimes(1);
    expect(mocks.refreshCompanionProjection).toHaveBeenCalledWith({ notify: true });
  });
});
