import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingCreate: vi.fn(),
  bookingUpdate: vi.fn(),
  assetAllocationFindMany: vi.fn(),
  assetAllocationUpdateMany: vi.fn(),
  serializedCount: vi.fn(),
  serializedUpdateMany: vi.fn(),
  createAuditEntryTx: vi.fn(),
  nextBookingRef: vi.fn(),
  notificationCreateManyAndReturn: vi.fn(),
  sendPushToUser: vi.fn(),
  deferPush: vi.fn(),
}));

const tx = {
  user: { findFirst: mocks.userFindFirst },
  booking: { findUnique: mocks.bookingFindUnique, create: mocks.bookingCreate, update: mocks.bookingUpdate },
  assetAllocation: { findMany: mocks.assetAllocationFindMany, updateMany: mocks.assetAllocationUpdateMany },
  bookingSerializedItem: { count: mocks.serializedCount, updateMany: mocks.serializedUpdateMany },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    notification: { createManyAndReturn: mocks.notificationCreateManyAndReturn },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/booking-ref", () => ({ nextBookingRef: mocks.nextBookingRef }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: mocks.sendPushToUser, deferPush: mocks.deferPush }));

import { transferKioskItems, OWNER_TRANSFER_REASON, kioskHandoverCopy } from "@/lib/services/kiosk-item-transfer";

const updatedAt = new Date("2026-09-25T15:00:00.000Z");
const endsAt = new Date("2026-09-26T23:00:00.000Z");

function source(extra: Record<string, unknown> = {}) {
  return {
    id: "co-1", kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requesterUserId: "owner-1",
    requester: { id: "owner-1", name: "Bucky Badger" }, title: "Soccer at Iowa", refNumber: "CO-1",
    updatedAt, startsAt: new Date("2026-09-25T12:00:00.000Z"), endsAt, locationId: "loc-1",
    sourceReservationId: null, eventId: null, sportCode: null, pickupKioskDeviceId: null,
    events: [], accountabilityExclusion: null, scanSessions: [],
    serializedItems: [
      { id: "bsi-1", assetId: "asset-1", allocationStatus: "active", asset: { assetTag: "CAM-1" } },
      { id: "bsi-2", assetId: "asset-2", allocationStatus: "active", asset: { assetTag: "CAM-2" } },
    ],
    bulkItems: [],
    ...extra,
  };
}

function actor(id: string, role: string) {
  return { id, role };
}

function transfer(extra: Record<string, unknown> = {}) {
  return transferKioskItems({
    sourceId: "co-1", actorId: "owner-1", expectedUpdatedAt: updatedAt,
    targetUserId: "peer-1", assetIds: ["asset-1"], bulkUnitIds: [], kioskId: "kiosk-1",
    ...extra,
  } as Parameters<typeof transferKioskItems>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bookingFindUnique.mockResolvedValue(source());
  mocks.assetAllocationFindMany.mockResolvedValue([{ id: "alloc-1", assetId: "asset-1", bookingId: "co-1", endsAt }]);
  mocks.bookingCreate.mockResolvedValue({ id: "co-2", title: "Soccer at Iowa", endsAt, updatedAt });
  mocks.serializedCount.mockResolvedValue(0);
  mocks.nextBookingRef.mockResolvedValue("CO-2");
  mocks.notificationCreateManyAndReturn.mockImplementation(async ({ data }: { data: Array<{ userId: string }> }) =>
    data.map((row, index) => ({ id: `n-${index}`, userId: row.userId })));
});

describe("kiosk peer transfer", () => {
  it("lets the owner hand part of a personal checkout to someone on the roster, with a default reason", async () => {
    mocks.userFindFirst
      .mockResolvedValueOnce(actor("owner-1", "STUDENT"))
      .mockResolvedValueOnce({ id: "peer-1", name: "Erik Role" });

    const result = await transfer();

    expect(result).toMatchObject({ success: true, targetBookingId: "co-2", sourceClosed: false, itemCount: 1 });
    expect(mocks.bookingCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ requesterUserId: "peer-1", custodyScope: "PERSON" }) });
    const actions = mocks.createAuditEntryTx.mock.calls.map((call) => call[1].action);
    expect(actions).toEqual(["kiosk_items_transferred_out", "kiosk_items_transferred_in"]);
    expect(mocks.createAuditEntryTx.mock.calls[0]![1].after.reason).toBe(OWNER_TRANSFER_REASON);
    const notes = mocks.notificationCreateManyAndReturn.mock.calls[0]![0].data;
    expect(notes.map((n: { userId: string; title: string }) => [n.userId, n.title])).toEqual([
      ["peer-1", "Bucky Badger handed you Soccer at Iowa"],
      ["owner-1", "You handed Soccer at Iowa to Erik Role"],
    ]);
    expect(notes[0].body).toMatch(/^It's on your record now\. It's due .+\.$/);
    expect(notes[1].body).toBe("1 item is off your record now. The rest is still with you.");
    expect(mocks.deferPush).toHaveBeenCalledTimes(2);
  });

  it("lets the owner hand over the whole checkout", async () => {
    mocks.userFindFirst
      .mockResolvedValueOnce(actor("owner-1", "STUDENT"))
      .mockResolvedValueOnce({ id: "peer-1", name: "Erik Role" });
    mocks.assetAllocationFindMany.mockResolvedValue([
      { id: "alloc-1", assetId: "asset-1", bookingId: "co-1", endsAt },
      { id: "alloc-2", assetId: "asset-2", bookingId: "co-1", endsAt },
    ]);
    const result = await transfer({ assetIds: ["asset-1", "asset-2"] });
    expect(result.sourceClosed).toBe(true);
    expect(mocks.notificationCreateManyAndReturn.mock.calls[0]![0].data[1].body).toBe("It's off your record now.");
  });

  it("rejects someone who neither owns the checkout nor is staff", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(actor("other-1", "STUDENT"));
    await expect(transfer({ actorId: "other-1" })).rejects.toMatchObject({ status: 403, data: { code: "transfer_not_allowed" } });
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("keeps SHARED custody staff-only", async () => {
    mocks.bookingFindUnique.mockResolvedValue(source({ custodyScope: "SHARED" }));
    mocks.userFindFirst.mockResolvedValueOnce(actor("owner-1", "STUDENT"));
    await expect(transfer()).rejects.toMatchObject({ status: 403 });
  });

  it("keeps merging into another checkout staff-only, even for the owner", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(actor("owner-1", "STUDENT"));
    await expect(transfer({ targetUserId: undefined, targetBookingId: "co-9" })).rejects.toMatchObject({ status: 403 });
  });

  it("leaves staff transfers unchanged: reason required, no handover pushes", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(actor("staff-1", "STAFF"));
    await expect(transfer({ actorId: "staff-1" })).rejects.toMatchObject({ status: 400 });

    mocks.userFindFirst
      .mockResolvedValueOnce(actor("staff-1", "STAFF"))
      .mockResolvedValueOnce({ id: "peer-1", name: "Erik Role" });
    const result = await transfer({ actorId: "staff-1", reason: "Swapped at the game" });
    expect(result.success).toBe(true);
    expect(mocks.createAuditEntryTx.mock.calls[0]![1].after.reason).toBe("Swapped at the game");
    expect(mocks.notificationCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("refuses handing gear to its current holder", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(actor("owner-1", "STUDENT"));
    await expect(transfer({ targetUserId: "owner-1" })).rejects.toMatchObject({ status: 400 });
  });

  it("words the handover copy", () => {
    const copy = kioskHandoverCopy({ title: "Kit", endsAt, ownerName: "A", targetName: "B", itemCount: 3, sourceClosed: false });
    expect(copy.toOldHolder.body).toBe("3 items are off your record now. The rest is still with you.");
  });
});
