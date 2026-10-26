import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: { findFirst: vi.fn() },
    booking: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    assetAllocation: { findMany: vi.fn(), updateMany: vi.fn() },
    bookingSerializedItem: { count: vi.fn(), updateMany: vi.fn() },
    bookingBulkItem: { upsert: vi.fn(), update: vi.fn() },
    bookingBulkUnitAllocation: { count: vi.fn(), updateMany: vi.fn() },
    bulkStockMovement: { createMany: vi.fn() },
  };
  return { tx, audit: vi.fn(), notify: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db: { $transaction: (run: (client: typeof mocks.tx) => unknown) => run(mocks.tx) } }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/services/booking-ref", () => ({ nextBookingRef: vi.fn(async () => "CO-2") }));
vi.mock("@/lib/services/gear-handover-notify", () => ({ notifyGearHandover: mocks.notify }));

import { transferKioskItems } from "@/lib/services/kiosk-item-transfer";
import { issueKioskStaffToken } from "@/lib/kiosk-staff-token";

vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters-long");

const { tx } = mocks;
const updatedAt = new Date("2026-10-25T15:00:00.000Z");
const endsAt = new Date("2026-10-26T23:00:00.000Z");

function source(extra: Record<string, unknown> = {}) {
  return {
    id: "co-1", kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requesterUserId: "owner-1",
    requester: { id: "owner-1", name: "Bucky" }, title: "Soccer at Iowa", refNumber: "CO-1",
    updatedAt, startsAt: updatedAt, endsAt, locationId: "loc-1",
    events: [], accountabilityExclusion: null, scanSessions: [],
    serializedItems: [{ id: "bsi-1", assetId: "asset-1", allocationStatus: "active" }],
    bulkItems: [{
      id: "bbi-1", bulkSkuId: "sku-1", checkedOutQuantity: 2, checkedInQuantity: 0,
      unitAllocations: [
        { id: "ua-1", bulkSkuUnitId: "unit-1", checkedOutAt: updatedAt, checkedInAt: null },
        { id: "ua-2", bulkSkuUnitId: "unit-2", checkedOutAt: updatedAt, checkedInAt: null },
      ],
    }],
    ...extra,
  };
}

function transfer(extra: Record<string, unknown> = {}) {
  return transferKioskItems({
    sourceId: "co-1", actorId: "owner-1", expectedUpdatedAt: updatedAt,
    targetUserId: "peer-1", assetIds: [], bulkUnitIds: ["unit-1"], kioskId: "kiosk-1",
    ...extra,
  } as Parameters<typeof transferKioskItems>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id === "owner-1") return { id: "owner-1", name: "Bucky", role: "STUDENT" };
    if (where.id === "staff-1") return { id: "staff-1", name: "Sam", role: "STAFF" };
    if (where.id === "peer-1") return { id: "peer-1", name: "Ada" };
    return null;
  });
  tx.booking.findUnique.mockResolvedValue(source());
  tx.booking.create.mockResolvedValue({ id: "co-2", title: "Soccer at Iowa", endsAt, updatedAt });
  tx.assetAllocation.findMany.mockResolvedValue([]);
  tx.bookingSerializedItem.count.mockResolvedValue(0);
  tx.bookingBulkItem.upsert.mockResolvedValue({ id: "bbi-2" });
  tx.bookingBulkUnitAllocation.count.mockResolvedValue(0);
});

describe("transferKioskItems guards", () => {
  it("needs an active operator and an open checkout", async () => {
    await expect(transfer({ actorId: "ghost" })).rejects.toMatchObject({ status: 403, message: "Choose an active operator" });

    tx.booking.findUnique.mockResolvedValueOnce(source({ status: "COMPLETED" }));
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: "Refresh the open checkout before transferring gear" });
  });

  it("refuses a stale screen, an open return and an unresolved exclusion", async () => {
    await expect(transfer({ expectedUpdatedAt: new Date(updatedAt.getTime() - 1) })).rejects.toMatchObject({ status: 409 });

    tx.booking.findUnique.mockResolvedValueOnce(source({ scanSessions: [{ id: "s1" }] }));
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Finish the return/) });

    tx.booking.findUnique.mockResolvedValueOnce(source({ accountabilityExclusion: { restoredAt: null } }));
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Finish the return/) });
  });

  it("refuses repeated, missing and empty selections", async () => {
    await expect(transfer({ bulkUnitIds: ["unit-1", "unit-1"] })).rejects.toMatchObject({ status: 400, message: "Select each item only once" });
    await expect(transfer({ bulkUnitIds: ["unit-9"] })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Some selected items are no longer out/) });
    await expect(transfer({ bulkUnitIds: [] })).rejects.toMatchObject({ status: 409 });

    const returned = source();
    returned.bulkItems[0]!.unitAllocations[0]!.checkedInAt = updatedAt as never;
    tx.booking.findUnique.mockResolvedValueOnce(returned);
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Some selected items are no longer out/) });
  });

  it("refuses an item whose custody record disagrees with the checkout", async () => {
    tx.assetAllocation.findMany.mockResolvedValue([{ id: "alloc-1", assetId: "asset-1", bookingId: "co-1", endsAt: new Date(endsAt.getTime() + 1) }]);

    await expect(transfer({ assetIds: ["asset-1"], bulkUnitIds: [] })).rejects.toMatchObject({ status: 409, message: "An item's custody record needs reconciliation before transfer" });
  });

  it("needs someone to receive the items", async () => {
    await expect(transfer({ targetUserId: "ghost" })).rejects.toMatchObject({ status: 400, message: "Choose the person or checkout receiving these items" });
  });

  it("refuses a staff merge into a checkout that doesn't line up", async () => {
    const staffToken = issueKioskStaffToken({ userId: "staff-1", kioskId: "kiosk-1" }).token;
    tx.booking.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (
      where.id === "co-1" ? source() : { id: "co-9", kind: "CHECKOUT", status: "OPEN", locationId: "loc-2", endsAt, scanSessions: [], accountabilityExclusion: null }
    ));

    await expect(transfer({ actorId: "staff-1", staffToken, reason: "Merged", targetUserId: undefined, targetBookingId: "co-9" }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Choose an open checkout at the same location/) });
  });

  it("refuses a receiving checkout that already has history for an item", async () => {
    tx.bookingSerializedItem.count.mockResolvedValue(1);
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already has history for a selected item/) });

    tx.bookingSerializedItem.count.mockResolvedValue(0);
    tx.bookingBulkUnitAllocation.count.mockResolvedValue(1);
    await expect(transfer()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already has history on the receiving checkout/) });
  });
});

describe("transferKioskItems with battery units", () => {
  it("moves a unit and its ledger obligation without touching shelf stock", async () => {
    const result = await transfer();

    expect(result).toMatchObject({ success: true, targetBookingId: "co-2", sourceClosed: false, itemCount: 1, message: "1 item transferred to Ada" });
    expect(tx.bookingBulkItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId_bulkSkuId: { bookingId: "co-2", bulkSkuId: "sku-1" } },
      create: expect.objectContaining({ plannedQuantity: 1, checkedOutQuantity: 1 }),
      update: { plannedQuantity: { increment: 1 }, checkedOutQuantity: { increment: 1 } },
    }));
    expect(tx.bookingBulkUnitAllocation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["ua-1"] } }, data: { bookingBulkItemId: "bbi-2" } });
    expect(tx.bookingBulkItem.update).toHaveBeenCalledWith({ where: { id: "bbi-1" }, data: { plannedQuantity: { decrement: 1 }, checkedOutQuantity: { decrement: 1 } } });
    const movements = tx.bulkStockMovement.createMany.mock.calls[0]?.[0].data as Array<{ bookingId: string; kind: string; quantity: number }>;
    expect(movements.map((row) => [row.bookingId, row.kind, row.quantity])).toEqual([["co-1", "CHECKIN", 1], ["co-2", "CHECKOUT", 1]]);
    expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: "co-1" }, data: { updatedAt: expect.any(Date) } });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ to: { id: "peer-1", name: "Ada" }, itemCount: 1 }));
  });

  it("closes the source checkout once nothing is left on it", async () => {
    tx.assetAllocation.findMany.mockResolvedValue([{ id: "alloc-1", assetId: "asset-1", bookingId: "co-1", endsAt }]);

    const result = await transfer({ assetIds: ["asset-1"], bulkUnitIds: ["unit-1", "unit-2"] });

    expect(result).toMatchObject({ sourceClosed: true, itemCount: 3, message: "3 items transferred to Ada" });
    expect(tx.bookingBulkItem.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ plannedQuantity: 2 }) }));
    expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: "co-1" }, data: { updatedAt: expect.any(Date), status: "CANCELLED" } });
  });
});
