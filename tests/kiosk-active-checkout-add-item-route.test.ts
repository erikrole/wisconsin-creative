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
  bookingBulkUnitAllocationCreate: vi.fn(),
  findBulkUnitByScanValue: vi.fn(),
  findAssetByScanValue: vi.fn(),
  checkAvailability: vi.fn(),
  bookingSerializedItemFindUnique: vi.fn(),
  bookingSerializedItemCreate: vi.fn(),
  bookingSerializedItemUpdate: vi.fn(),
  assetAllocationCreate: vi.fn(),
  upsertBulkBalancesAndMovements: vi.fn(),
  createAuditEntryTx: vi.fn(),
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

vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAssetByScanValue }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findBulkUnitByScanValue }));
vi.mock("@/lib/services/availability", () => ({ checkAvailability: mocks.checkAvailability }));
vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: mocks.upsertBulkBalancesAndMovements,
}));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: vi.fn() }));
vi.mock("@/lib/services/live-activities", () => ({ updateCheckoutReturnLiveActivities: vi.fn() }));

import { POST as addActiveCheckoutItem } from "@/app/api/kiosk/checkout/[id]/route";

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((handler) => handler({
    user: { findFirst: mocks.userFindFirst },
    booking: { findFirst: mocks.bookingFindFirst },
    bulkSkuUnit: {
      findUnique: mocks.bulkSkuUnitFindUnique,
      updateMany: mocks.bulkSkuUnitUpdateMany,
      count: mocks.bulkSkuUnitCount,
    },
    bulkStockBalance: {
      findMany: mocks.bulkStockBalanceFindMany,
      upsert: mocks.bulkStockBalanceUpsert,
    },
    bulkStockMovement: { create: mocks.bulkStockMovementCreate },
    bookingBulkItem: { upsert: mocks.bookingBulkItemUpsert },
    bookingBulkUnitAllocation: { create: mocks.bookingBulkUnitAllocationCreate },
    bookingSerializedItem: {
      findUnique: mocks.bookingSerializedItemFindUnique,
      create: mocks.bookingSerializedItemCreate,
      update: mocks.bookingSerializedItemUpdate,
    },
    assetAllocation: { create: mocks.assetAllocationCreate },
  }));
  mocks.userFindFirst.mockResolvedValue({ id: "actor-1", role: "STAFF" });
  mocks.bookingFindFirst.mockResolvedValue({
    id: "checkout-1",
    title: "VB vs Auburn",
    startsAt: new Date("2026-09-03T18:00:00.000Z"),
    endsAt: new Date("2026-09-04T04:00:00.000Z"),
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
});
