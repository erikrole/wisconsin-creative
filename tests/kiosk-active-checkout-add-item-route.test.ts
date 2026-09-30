import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  bookingFindFirst: vi.fn(),
  bulkSkuUnitFindUnique: vi.fn(),
  bulkSkuUnitUpdateMany: vi.fn(),
  bulkSkuUnitCount: vi.fn(),
  bulkStockBalanceFindMany: vi.fn(),
  bulkStockBalanceUpsert: vi.fn(),
  bulkStockMovementCreate: vi.fn(),
  bookingBulkItemUpsert: vi.fn(),
  bookingBulkItemFindUnique: vi.fn(),
  bookingBulkUnitAllocationFindUnique: vi.fn(),
  bookingBulkUnitAllocationUpdate: vi.fn(),
  scanEventCreate: vi.fn(),
  bookingBulkUnitAllocationCreate: vi.fn(),
  bookingBulkUnitAllocationFindFirst: vi.fn(),
  bookingBulkUnitAllocationDelete: vi.fn(),
  bookingBulkItemDelete: vi.fn(),
  bookingBulkItemUpdate: vi.fn(),
  bulkSkuUnitUpdate: vi.fn(),
  findBulkUnitByScanValue: vi.fn(),
  findAssetByScanValue: vi.fn(),
  checkAvailability: vi.fn(),
  bookingSerializedItemFindUnique: vi.fn(),
  bookingSerializedItemCreate: vi.fn(),
  bookingSerializedItemUpdate: vi.fn(),
  assetAllocationCreate: vi.fn(),
  upsertBulkBalancesAndMovements: vi.fn(),
  createAuditEntryTx: vi.fn(),
  bookingSerializedItemCount: vi.fn(),
  bookingBulkItemFindMany: vi.fn(),
  assetAllocationUpdateMany: vi.fn(),
  bookingUpdate: vi.fn(),
  scanSessionUpdateMany: vi.fn(),
  settleBulkLedgerAtCompletion: vi.fn(),
  endCheckoutReturnLiveActivities: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: { kioskId: string; name: string; locationId: string; locationName: string };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) => handler(req, {
    params: await ctx.params,
    kiosk: {
      kioskId: "kiosk-1",
      name: "Camp Randall Kiosk",
      locationId: "loc-1",
      locationName: "Camp Randall Video Office",
    },
  }),
}));

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx, lookupActorRole: vi.fn() }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAssetByScanValue }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findBulkUnitByScanValue }));
vi.mock("@/lib/services/availability", () => ({
  checkAvailability: mocks.checkAvailability,
  hasBlockingAvailabilityIssue: (result: { conflicts: unknown[]; shortages: unknown[]; unavailableAssets: unknown[] }) =>
    result.conflicts.length > 0 || result.shortages.length > 0 || result.unavailableAssets.length > 0,
}));
vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: mocks.upsertBulkBalancesAndMovements,
  settleBulkLedgerAtCompletion: mocks.settleBulkLedgerAtCompletion,
}));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: vi.fn() }));
vi.mock("@/lib/services/live-activities", () => ({
  updateCheckoutReturnLiveActivities: vi.fn(),
  endCheckoutReturnLiveActivities: mocks.endCheckoutReturnLiveActivities,
}));

import { POST as addActiveCheckoutItem, DELETE as removeActiveCheckoutItem } from "@/app/api/kiosk/checkout/[id]/route";

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((handler) => handler({
    user: { findFirst: mocks.userFindFirst },
    booking: { findFirst: mocks.bookingFindFirst, update: mocks.bookingUpdate },
    bulkSkuUnit: {
      findUnique: mocks.bulkSkuUnitFindUnique,
      updateMany: mocks.bulkSkuUnitUpdateMany,
      count: mocks.bulkSkuUnitCount,
      update: mocks.bulkSkuUnitUpdate,
    },
    bulkStockBalance: {
      findMany: mocks.bulkStockBalanceFindMany,
      upsert: mocks.bulkStockBalanceUpsert,
    },
    bulkStockMovement: { create: mocks.bulkStockMovementCreate },
    bookingBulkItem: {
      upsert: mocks.bookingBulkItemUpsert,
      findUnique: mocks.bookingBulkItemFindUnique,
      delete: mocks.bookingBulkItemDelete,
      update: mocks.bookingBulkItemUpdate,
      findMany: mocks.bookingBulkItemFindMany,
    },
    bookingBulkUnitAllocation: {
      create: mocks.bookingBulkUnitAllocationCreate,
      findUnique: mocks.bookingBulkUnitAllocationFindUnique,
      update: mocks.bookingBulkUnitAllocationUpdate,
      findFirst: mocks.bookingBulkUnitAllocationFindFirst,
      delete: mocks.bookingBulkUnitAllocationDelete,
    },
    bookingSerializedItem: {
      findUnique: mocks.bookingSerializedItemFindUnique,
      create: mocks.bookingSerializedItemCreate,
      update: mocks.bookingSerializedItemUpdate,
      count: mocks.bookingSerializedItemCount,
    },
    assetAllocation: { create: mocks.assetAllocationCreate, updateMany: mocks.assetAllocationUpdateMany },
    scanEvent: { create: mocks.scanEventCreate },
    scanSession: { updateMany: mocks.scanSessionUpdateMany },
  }));
  // Other gear is still out unless a test says otherwise.
  mocks.bookingSerializedItemCount.mockResolvedValue(1);
  mocks.bookingBulkItemFindMany.mockResolvedValue([]);
  mocks.userFindFirst.mockResolvedValue({ id: "actor-1", role: "STAFF" });
  mocks.bookingFindFirst.mockResolvedValue({
    id: "checkout-1",
    title: "VB vs Auburn",
    startsAt: new Date("2026-09-03T18:00:00.000Z"),
    // Due back in the future: adding gear to an overdue checkout is refused.
    endsAt: new Date(Date.now() + 24 * 60 * 60_000),
    locationId: "loc-field-house",
    location: { name: "Field House" },
    requesterUserId: "user-1",
  });
  mocks.findBulkUnitByScanValue.mockResolvedValue({
    id: "unit-21",
    name: "Sony NP-FZ100 Battery #21",
    status: "AVAILABLE",
    bulkSkuId: "cmnrtquja0021jp04780v9kej",
    unitNumber: 21,
  });
  mocks.bulkSkuUnitFindUnique.mockResolvedValue({
    id: "unit-21",
    bulkSkuId: "cmnrtquja0021jp04780v9kej",
    unitNumber: 21,
    bulkSku: {
      id: "cmnrtquja0021jp04780v9kej",
      name: "Sony NP-FZ100 Battery",
      active: true,
      imageUrl: null,
    },
  });
  mocks.bulkSkuUnitUpdateMany.mockResolvedValue({ count: 1 });
  mocks.bulkSkuUnitCount.mockResolvedValue(15);
  mocks.bulkStockBalanceFindMany.mockResolvedValue([{ onHandQuantity: 16 }]);
  mocks.bookingBulkItemFindUnique.mockResolvedValue(null);
  mocks.bookingBulkUnitAllocationFindUnique.mockResolvedValue(null);
  mocks.bookingBulkItemUpsert.mockResolvedValue({ id: "bulk-item-1" });
  mocks.bookingBulkUnitAllocationCreate.mockResolvedValue({ id: "allocation-1" });
  mocks.checkAvailability.mockResolvedValue({
    conflicts: [],
    shortages: [{
      bulkSkuId: "cmnrtquja0021jp04780v9kej",
      requested: 1,
      available: 0,
    }],
    unavailableAssets: [],
    upcomingCommitments: [],
    turnaroundRisks: [],
    bulkTurnaroundRisks: [],
  });
  mocks.findAssetByScanValue.mockResolvedValue(null);
  mocks.bookingSerializedItemFindUnique.mockResolvedValue(null);
});

describe("kiosk active checkout add item", () => {
  it("rejects mismatched battery counters before removing custody or restocking", async () => {
    const bulkSkuId = "cmnrtquja0021jp04780v9kej";
    mocks.bookingBulkUnitAllocationFindFirst.mockResolvedValueOnce({
      id: "allocation-21",
      bulkSkuUnit: { id: "unit-21", bulkSkuId, unitNumber: 21, bulkSku: { name: "Sony Battery" } },
      bookingBulkItem: { id: "bulk-item-1", plannedQuantity: 2, checkedOutQuantity: 2, checkedInQuantity: 2 },
    });
    await expect(removeActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "DELETE", body: JSON.stringify({ actorId: "actor-1", bulkSkuId, unitNumber: 21 }),
    }), routeContext("checkout-1"))).rejects.toMatchObject({ status: 409 });
    expect(mocks.bookingBulkUnitAllocationUpdate).not.toHaveBeenCalled();
    expect(mocks.bulkSkuUnitUpdate).not.toHaveBeenCalled();
    expect(mocks.upsertBulkBalancesAndMovements).not.toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it.each([0, 1])("restores the kiosk stock and preserves prior returns when removing a battery (%i returned)", async (checkedInQuantity) => {
    const bulkSkuId = "cmnrtquja0021jp04780v9kej";
    mocks.bookingBulkUnitAllocationFindFirst.mockResolvedValueOnce({
      id: "allocation-21",
      bulkSkuUnit: { id: "unit-21", bulkSkuId, unitNumber: 21, bulkSku: { name: "Sony Battery" } },
      bookingBulkItem: {
        id: "bulk-item-1", plannedQuantity: checkedInQuantity + 1,
        checkedOutQuantity: checkedInQuantity + 1, checkedInQuantity,
      },
    });
    const response = await removeActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "DELETE", body: JSON.stringify({ actorId: "actor-1", bulkSkuId, unitNumber: 21 }),
    }), routeContext("checkout-1"));
    expect(await response.json()).toEqual({ success: true, message: "Sony Battery #21 removed" });
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalledWith(expect.anything(), {
      locationId: "loc-1", bookingId: "checkout-1", actorUserId: "actor-1", kind: "CHECKIN",
      items: [{ bulkSkuId, quantity: 1 }],
    });
    expect(mocks.bookingBulkUnitAllocationDelete).not.toHaveBeenCalled();
    expect(mocks.bookingBulkUnitAllocationUpdate).toHaveBeenCalledWith({
      where: { id: "allocation-21" }, data: { checkedInAt: expect.any(Date) },
    });
    expect(mocks.bookingBulkItemDelete).not.toHaveBeenCalled();
    expect(mocks.bookingBulkItemUpdate).toHaveBeenCalledWith({
      where: { id: "bulk-item-1" }, data: { checkedInQuantity: { increment: 1 } },
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "kiosk_checkout_item_removed", before: expect.objectContaining({ stockLocationId: "loc-1" }),
    }));
  });

  it("lets an exact available unit scan override aggregate reservation commitments", async () => {
    const request = new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "POST",
      body: JSON.stringify({ actorId: "actor-1", scanValue: "94e068d1-21" }),
    });

    const response = await addActiveCheckoutItem(request, routeContext("checkout-1"));
    expect(await response.json()).toEqual({
      success: true,
      message: "Sony NP-FZ100 Battery #21 added",
    });
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.bulkSkuUnitUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "unit-21" }),
    }));
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      bookingId: "checkout-1",
      items: [{ bulkSkuId: "cmnrtquja0021jp04780v9kej", quantity: 1 }],
    }));
    expect(mocks.createAuditEntryTx).toHaveBeenCalled();
  });

  it("repairs a stale numbered-unit balance before accepting an exact available scan", async () => {
    mocks.bulkStockBalanceFindMany.mockResolvedValueOnce([{ onHandQuantity: 0 }]);

    const request = new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "POST",
      body: JSON.stringify({ actorId: "actor-1", scanValue: "94e068d1-21" }),
    });

    const response = await addActiveCheckoutItem(request, routeContext("checkout-1"));

    expect(await response.json()).toEqual({
      success: true,
      message: "Sony NP-FZ100 Battery #21 added",
    });
    expect(mocks.bulkStockBalanceUpsert).toHaveBeenCalledWith({
      where: {
        bulkSkuId_locationId: {
          bulkSkuId: "cmnrtquja0021jp04780v9kej",
          locationId: "loc-1",
        },
      },
      create: {
        bulkSkuId: "cmnrtquja0021jp04780v9kej",
        locationId: "loc-1",
        onHandQuantity: 16,
      },
      update: { onHandQuantity: { increment: 16 } },
    });
    expect(mocks.bulkStockMovementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "ADJUSTMENT",
        quantity: 16,
        reason: expect.stringContaining("available unit records"),
      }),
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "numbered_unit_balance_reconciled",
      before: { onHandQuantity: 0, availableUnitCount: 16 },
      after: expect.objectContaining({ onHandQuantity: 16, quantityAdded: 16 }),
    }));
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalled();
  });

  it("uses the authenticated kiosk stock when the checkout originated elsewhere", async () => {
    mocks.checkAvailability.mockResolvedValue({
      conflicts: [],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    const request = new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "POST",
      body: JSON.stringify({ actorId: "actor-1", scanValue: "94e068d1-21" }),
    });

    const response = await addActiveCheckoutItem(request, routeContext("checkout-1"));

    expect(await response.json()).toEqual({
      success: true,
      message: "Sony NP-FZ100 Battery #21 added",
    });
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.upsertBulkBalancesAndMovements).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-1",
      bookingId: "checkout-1",
      items: [{ bulkSkuId: "cmnrtquja0021jp04780v9kej", quantity: 1 }],
    }));
    expect(mocks.upsertBulkBalancesAndMovements).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      locationId: "loc-field-house",
    }));
  });

  it("names the person, item, and deadline when a reservation blocks a serialized add", async () => {
    mocks.findBulkUnitByScanValue.mockResolvedValue(null);
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-fx3-2",
      assetTag: "CAM-014",
      name: "FX3 2",
      imageUrl: null,
      status: "AVAILABLE",
      category: { name: "Camera" },
    });
    mocks.checkAvailability.mockResolvedValue({
      conflicts: [{
        assetId: "asset-fx3-2",
        conflictingBookingId: "reservation-1",
        conflictingBookingTitle: "Football Practice",
        conflictingBookingRequesterName: "Erik Role",
        conflictingBookingKind: "RESERVATION",
        conflictingBookingStatus: "BOOKED",
        startsAt: new Date("2026-09-12T19:00:00.000Z"),
        endsAt: new Date("2026-09-12T21:30:00.000Z"),
      }],
      shortages: [],
      unavailableAssets: [],
      upcomingCommitments: [],
      turnaroundRisks: [],
      bulkTurnaroundRisks: [],
    });

    const request = new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "POST",
      body: JSON.stringify({ actorId: "actor-1", scanValue: "fx3-2" }),
    });

    const response = await addActiveCheckoutItem(request, routeContext("checkout-1"));
    expect(await response.json()).toEqual({
      success: false,
      error: "Erik Role has reserved the FX3 2 until Sep 12 at 4:30 PM",
    });
    expect(mocks.bookingSerializedItemCreate).not.toHaveBeenCalled();
    expect(mocks.assetAllocationCreate).not.toHaveBeenCalled();
  });

  it("refuses to add gear to an overdue checkout before writing any custody", async () => {
    mocks.findBulkUnitByScanValue.mockResolvedValue(null);
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-fx3-2", assetTag: "CAM-014", name: "FX3 2", imageUrl: null, status: "AVAILABLE", category: { name: "Camera" },
    });
    mocks.bookingFindFirst.mockResolvedValue({
      id: "checkout-1", title: "VB", startsAt: new Date("2026-09-03T18:00:00.000Z"),
      endsAt: new Date(Date.now() - 60_000), locationId: "loc-1", requesterUserId: "actor-1", custodyScope: "PERSON",
    });

    const response = await addActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "POST", body: JSON.stringify({ actorId: "actor-1", scanValue: "fx3-2" }),
    }), routeContext("checkout-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: false,
      error: "This checkout is overdue. Update the return time before adding items.",
    });
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.bookingSerializedItemCreate).not.toHaveBeenCalled();
    expect(mocks.assetAllocationCreate).not.toHaveBeenCalled();
    expect(mocks.bulkSkuUnitUpdateMany).not.toHaveBeenCalled();
  });

  it("completes the checkout when the last active item is removed", async () => {
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "item-1", allocationStatus: "active", asset: { assetTag: "CAM-014", name: "FX3 2" },
    });
    mocks.bookingSerializedItemCount.mockResolvedValue(0);
    mocks.bookingBulkItemFindMany.mockResolvedValue([]);

    const response = await removeActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "DELETE", body: JSON.stringify({ actorId: "actor-1", assetId: "asset-fx3-2" }),
    }), routeContext("checkout-1"));

    expect(await response.json()).toEqual({ success: true, message: "FX3 2 removed", completed: true });
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "checkout-1" },
      data: { status: "COMPLETED", completedAt: expect.any(Date) },
    });
    expect(mocks.settleBulkLedgerAtCompletion).toHaveBeenCalled();
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "auto_completed_by_kiosk_checkin",
    }));
    expect(mocks.endCheckoutReturnLiveActivities).toHaveBeenCalledWith("checkout-1");
  });

  it("leaves the checkout open when other gear is still out", async () => {
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "item-1", allocationStatus: "active", asset: { assetTag: "CAM-014", name: "FX3 2" },
    });

    const response = await removeActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "DELETE", body: JSON.stringify({ actorId: "actor-1", assetId: "asset-fx3-2" }),
    }), routeContext("checkout-1"));

    expect(await response.json()).toEqual({ success: true, message: "FX3 2 removed" });
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
    expect(mocks.endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
  });

  describe("who may edit a live checkout", () => {
    const removeSerialized = () => removeActiveCheckoutItem(new Request("http://test/api/kiosk/checkout/checkout-1", {
      method: "DELETE", body: JSON.stringify({ actorId: "actor-1", assetId: "asset-1" }),
    }), routeContext("checkout-1"));

    it("refuses a student removing gear from someone else's personal checkout", async () => {
      mocks.userFindFirst.mockResolvedValue({ id: "actor-1", role: "STUDENT" });
      mocks.bookingFindFirst.mockResolvedValue({
        id: "checkout-1", title: "VB", startsAt: new Date(), endsAt: new Date(),
        locationId: "loc-1", requesterUserId: "user-1", custodyScope: "PERSON",
      });
      await expect(removeSerialized()).rejects.toMatchObject({ status: 403 });
      expect(mocks.bookingSerializedItemUpdate).not.toHaveBeenCalled();
      expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
    });

    it("lets the owner, and the operator of a shared checkout, past the editor check", async () => {
      mocks.bookingSerializedItemFindUnique.mockResolvedValue(null);
      for (const booking of [
        { requesterUserId: "actor-1", custodyScope: "PERSON" },
        { requesterUserId: "user-1", custodyScope: "SHARED" },
      ]) {
        mocks.userFindFirst.mockResolvedValue({ id: "actor-1", role: "STUDENT" });
        mocks.bookingFindFirst.mockResolvedValue({
          id: "checkout-1", title: "VB", startsAt: new Date(), endsAt: new Date(),
          locationId: "loc-1", ...booking,
        });
        const response = await removeSerialized();
        expect(await response.json()).toEqual({ success: false, error: "Item is not active on this checkout" });
      }
    });

    it("resolves the actor with the kiosk roster rule, not just active", async () => {
      mocks.userFindFirst.mockResolvedValue(null);
      await expect(removeSerialized()).rejects.toMatchObject({ status: 404 });
      expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: "actor-1", hiddenFromRoster: false }),
      }));
    });
  });
});
