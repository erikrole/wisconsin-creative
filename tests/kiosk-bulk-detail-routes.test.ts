import { describe, expect, it, vi, beforeEach } from "vitest";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  bookingUpdateMany: vi.fn(),
  bookingSerializedItemFindUnique: vi.fn(),
  scanEventFindFirst: vi.fn(),
  scanEventCreate: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  createAuditEntryTx: vi.fn(),
  createAuditEntry: vi.fn(),
  findAssetByScanValue: vi.fn(),
  scanKioskPickupBulkUnit: vi.fn(),
  stageKioskReservationPickupBulkUnit: vi.fn(),
  createBooking: vi.fn(),
  badgeOnScanResult: vi.fn(),
  badgeOnCheckoutOpened: vi.fn(),
  earnedBadgesSince: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
      updateMany: mocks.bookingUpdateMany,
    },
    bookingSerializedItem: {
      findUnique: mocks.bookingSerializedItemFindUnique,
    },
    scanEvent: {
      findFirst: mocks.scanEventFindFirst,
      create: mocks.scanEventCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: {
      params: P;
      kiosk: {
        kioskId: string;
        locationId: string;
        locationName: string;
      };
    }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, {
      params: await ctx.params,
      kiosk: {
        kioskId: "kiosk-1",
        locationId: "loc-1",
        locationName: "Camp Randall",
      },
    }),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.createAuditEntryTx,
  createAuditEntry: mocks.createAuditEntry,
}));

vi.mock("@/lib/services/bookings", () => ({
  createBooking: mocks.createBooking,
}));

vi.mock("@/lib/services/kiosk-scan", () => ({
  findAssetByScanValue: mocks.findAssetByScanValue,
}));

vi.mock("@/lib/services/bulk-unit-scans", () => ({
  scanKioskPickupBulkUnit: mocks.scanKioskPickupBulkUnit,
  stageKioskReservationPickupBulkUnit: mocks.stageKioskReservationPickupBulkUnit,
}));

vi.mock("@/lib/services/kiosk-location", () => ({
  assetLocationEvidence: vi.fn().mockResolvedValue({
    locationMismatch: false,
    expectedLocationId: "loc-1",
    actualLocationId: "loc-1",
  }),
  locationEvidencePayload: vi.fn(() => ({})),
  reconcileAssetLocationToKiosk: vi.fn(),
}));

vi.mock("@/lib/badges", () => ({
  badges: {
    onScanResult: mocks.badgeOnScanResult,
    onCheckoutOpened: mocks.badgeOnCheckoutOpened,
  },
  earnedBadgesSince: mocks.earnedBadgesSince,
}));

import { GET as getKioskCheckoutDetail } from "@/app/api/kiosk/checkout/[id]/route";
import { POST as scanKioskPickup } from "@/app/api/kiosk/pickup/[id]/scan/route";
import { POST as confirmKioskPickup } from "@/app/api/kiosk/pickup/[id]/confirm/route";

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((handler) => handler({
    booking: {
      findUnique: mocks.bookingFindUnique,
      updateMany: mocks.bookingUpdateMany,
    },
    scanEvent: {
      create: mocks.scanEventCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  }));
  mocks.bookingUpdateMany.mockResolvedValue({ count: 1 });
  mocks.scanEventFindFirst.mockResolvedValue(null);
  mocks.stageKioskReservationPickupBulkUnit.mockResolvedValue({ handled: false });
  mocks.createBooking.mockResolvedValue({ id: "checkout-1" });
  mocks.earnedBadgesSince.mockResolvedValue([]);
});

describe("kiosk checkout detail bulk units", () => {
  it("includes pending pickup battery quantity as scan checklist slots", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Women's Soccer vs Tcu",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 2,
        checkedOutQuantity: 0,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-1",
          name: "Sony Battery",
          category: "Batteries",
          trackByNumber: true,
        },
        unitAllocations: [],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([
      {
        id: "bulk-item-1:slot:1",
        tagName: "#1",
        name: "Sony Battery 1",
        returned: false,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: null,
      },
      {
        id: "bulk-item-1:slot:2",
        tagName: "#2",
        name: "Sony Battery 2",
        returned: false,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: null,
      },
    ]);
    expect(json.scanSummary).toEqual({
      serializedTotal: 0,
      numberedBulkTotal: 2,
      numberedBulkCompleted: 0,
    });
    expect(json.title).toBe("Women's Soccer vs TCU");
  });

  it("rebuilds reservation battery rows from persisted scan events after reload", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "reservation-1",
      title: "Camera reservation",
      refNumber: "RV-1001",
      status: "BOOKED",
      kind: "RESERVATION",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [{
        assetId: null,
        bulkSkuId: "sku-1",
        scanType: "BULK_BIN",
        scanValue: "sony-battery-7",
      }],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 3,
        checkedOutQuantity: 0,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-1",
          name: "Sony Battery",
          category: "Batteries",
          binQrCodeValue: "sony-battery",
          trackByNumber: true,
          imageUrl: null,
        },
        unitAllocations: [],
      }],
      derivedCheckouts: [],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("reservation-1"));
    const json = await res.json();

    expect(json.items[0]).toMatchObject({
      id: "bulk-item-1:slot:1",
      tagName: "#7",
      name: "Sony Battery #7",
      returned: true,
      unitNumber: 7,
    });
    expect(json.items[1]).toMatchObject({
      id: "bulk-item-1:slot:2",
      tagName: "#2",
      returned: false,
      unitNumber: null,
    });
    expect(json.scanSummary).toEqual({
      serializedTotal: 0,
      numberedBulkTotal: 3,
      numberedBulkCompleted: 1,
    });
  });

  it("preserves individual numbered pickup slots at the exact checklist ceiling", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
        checkedOutQuantity: 0,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-1",
          name: "Sony Battery",
          category: "Batteries",
          trackByNumber: true,
        },
        unitAllocations: [],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toHaveLength(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST);
    expect(json.items[0]).toMatchObject({ id: "bulk-item-1:slot:1", type: "numbered_bulk" });
    expect(json.items.at(-1)).toMatchObject({
      id: `bulk-item-1:slot:${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST}`,
      type: "numbered_bulk",
    });
  });

  it("rejects numbered pickup lists above the checklist ceiling before expansion", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [
        {
          id: "bulk-item-1",
          plannedQuantity: 250,
          checkedOutQuantity: 0,
          checkedInQuantity: 0,
          bulkSku: {
            id: "sku-1",
            name: "Sony Battery",
            category: "Batteries",
            trackByNumber: true,
          },
          unitAllocations: [],
        },
        {
          id: "bulk-item-2",
          plannedQuantity: 251,
          checkedOutQuantity: 0,
          checkedInQuantity: 0,
          bulkSku: {
            id: "sku-2",
            name: "Canon Battery",
            category: "Batteries",
            trackByNumber: true,
          },
          unitAllocations: [],
        },
      ],
    });

    await expect(getKioskCheckoutDetail(
      new Request("http://test"),
      routeCtx("booking-1"),
    )).rejects.toThrow(`at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} units total`);
  });

  it("emits one aggregate row for a large non-numbered pickup quantity", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 1_000_000,
        checkedOutQuantity: 0,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-tape",
          name: "Gaffer Tape",
          category: "Supplies",
          trackByNumber: false,
        },
        unitAllocations: [],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([{
      id: "bulk-item-1:bulk-quantity",
      tagName: "x1000000",
      name: "Gaffer Tape x1000000",
      returned: true,
      type: "bulk_quantity",
      bulkSkuId: "sku-tape",
      bulkSkuName: "Gaffer Tape",
      unitNumber: null,
    }]);
  });

  it("includes checked-out battery units in return detail", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Return",
      refNumber: "CO-1001",
      status: "OPEN",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 2,
        checkedOutQuantity: 2,
        checkedInQuantity: 1,
        bulkSku: {
          id: "sku-1",
          name: "Sony Battery",
          category: "Batteries",
          trackByNumber: true,
        },
        unitAllocations: [
          {
            checkedInAt: null,
            bulkSkuUnit: { id: "unit-7", unitNumber: 7 },
          },
          {
            checkedInAt: new Date("2026-05-05T12:00:00.000Z"),
            bulkSkuUnit: { id: "unit-11", unitNumber: 11 },
          },
        ],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([
      {
        id: "unit-7",
        tagName: "#7",
        name: "Sony Battery #7",
        returned: false,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: 7,
      },
      {
        id: "unit-11",
        tagName: "#11",
        name: "Sony Battery #11",
        returned: true,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: 11,
      },
    ]);
    expect(json.scanSummary).toEqual({
      serializedTotal: 0,
      numberedBulkTotal: 2,
      numberedBulkCompleted: 1,
    });
  });

  it("includes checked-out battery quantity when unit allocation rows are missing", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Chris Hall checkout",
      refNumber: "CO-1001",
      status: "OPEN",
      kind: "CHECKOUT",
      requesterUserId: "user-chris",
      endsAt: new Date("2026-06-29T23:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 8,
        checkedOutQuantity: 8,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-sony",
          name: "Sony Battery",
          category: "Batteries",
          trackByNumber: true,
        },
        unitAllocations: [],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([
      {
        id: "bulk-item-1:bulk-quantity",
        tagName: "x8",
        name: "Sony Battery x8",
        returned: false,
        type: "bulk_quantity",
        bulkSkuId: "sku-sony",
        bulkSkuName: "Sony Battery",
        unitNumber: null,
      },
    ]);
    expect(json.scanSummary).toEqual({
      serializedTotal: 0,
      numberedBulkTotal: 8,
      numberedBulkCompleted: 0,
    });
  });

  it("marks already-picked battery slots when a pending pickup is resumed", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [],
      bulkItems: [{
        id: "bulk-item-1",
        plannedQuantity: 2,
        checkedOutQuantity: 1,
        checkedInQuantity: 0,
        bulkSku: {
          id: "sku-1",
          name: "Sony Battery",
          category: "Batteries",
          trackByNumber: true,
        },
        unitAllocations: [{
          checkedInAt: null,
          bulkSkuUnit: { id: "unit-7", unitNumber: 7 },
        }],
      }],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([
      {
        id: "bulk-item-1:slot:1",
        tagName: "#7",
        name: "Sony Battery #7",
        returned: true,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: 7,
      },
      {
        id: "bulk-item-1:slot:2",
        tagName: "#2",
        name: "Sony Battery 2",
        returned: false,
        type: "numbered_bulk",
        bulkSkuId: "sku-1",
        bulkSkuName: "Sony Battery",
        unitNumber: null,
      },
    ]);
    expect(json.scanSummary).toEqual({
      serializedTotal: 0,
      numberedBulkTotal: 2,
      numberedBulkCompleted: 1,
    });
  });

  it("marks already-scanned serialized items when a pending pickup is resumed", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [{ assetId: "asset-1", bulkSkuId: null, scanType: "SERIALIZED" }],
      serializedItems: [{
        id: "serialized-1",
        allocationStatus: "active",
        asset: {
          id: "asset-1",
          assetTag: "FX3 1",
          name: "Camera",
          imageUrl: null,
        },
      }],
      bulkItems: [],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items).toEqual([{
      id: "asset-1",
      tagName: "FX3 1",
      name: "Camera",
      returned: true,
      type: "serialized",
      imageUrl: null,
    }]);
    expect(json.scanSummary.serializedTotal).toBe(1);
  });

  it("keeps unscanned serialized items unchecked in pending pickup detail", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      title: "Pickup",
      refNumber: "CO-1001",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      endsAt: new Date("2026-05-06T12:00:00.000Z"),
      scanEvents: [],
      serializedItems: [{
        id: "serialized-1",
        allocationStatus: "active",
        asset: {
          id: "asset-1",
          assetTag: "FX3 1",
          name: "Camera",
          imageUrl: null,
        },
      }],
      bulkItems: [],
    });

    const res = await getKioskCheckoutDetail(new Request("http://test"), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.items[0]).toMatchObject({
      id: "asset-1",
      returned: false,
      type: "serialized",
    });
  });
});

describe("kiosk pickup serialized scan guard", () => {
  it("attributes a shared reservation scan to the identified operator", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "reservation-1",
      status: "BOOKED",
      kind: "RESERVATION",
      custodyScope: "SHARED",
      requesterUserId: "creator-1",
      locationId: "loc-1",
    });
    mocks.userFindFirst.mockResolvedValue({ id: "operator-1" });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FB FX3 1",
      name: "FB FX3 1",
    });
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "serialized-1",
      bookingId: "reservation-1",
      assetId: "asset-1",
      allocationStatus: "active",
    });

    const res = await scanKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "operator-1", scanValue: "FB-FX3-1" }),
    }), routeCtx("reservation-1"));

    expect(res.status).toBe(200);
    expect(mocks.scanEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "reservation-1",
        actorUserId: "operator-1",
      }),
    });
  });

  it("records successful serialized pickup scans before confirmation", async () => {
    mocks.scanKioskPickupBulkUnit.mockResolvedValue({ handled: false });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 1",
    });
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "serialized-1",
      bookingId: "booking-1",
      assetId: "asset-1",
    });
    mocks.scanEventCreate.mockResolvedValue({ id: "scan-1" });

    const res = await scanKioskPickup(new Request("http://test", {
      method: "POST",
      headers: { "user-agent": "vitest-kiosk" },
      body: JSON.stringify({ scanValue: "23723854" }),
    }), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mocks.findAssetByScanValue).toHaveBeenCalledWith("23723854", {
      id: true,
      assetTag: true,
      name: true,
    });
    expect(mocks.scanEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking-1",
        actorUserId: "user-1",
        scanType: "SERIALIZED",
        scanValue: "23723854",
        success: true,
        phase: "CHECKOUT",
        assetId: "asset-1",
        deviceContext: "vitest-kiosk",
      }),
    });
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
  });

  it("returns duplicate feedback for repeated serialized pickup scans", async () => {
    mocks.scanKioskPickupBulkUnit.mockResolvedValue({ handled: false });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 1",
    });
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "serialized-1",
      bookingId: "booking-1",
      assetId: "asset-1",
    });
    mocks.scanEventFindFirst.mockResolvedValue({ id: "scan-1" });

    const res = await scanKioskPickup(new Request("http://test", {
      method: "POST",
      headers: { "user-agent": "vitest-kiosk" },
      body: JSON.stringify({ scanValue: "23723854" }),
    }), routeCtx("booking-1"));
    const json = await res.json();

    expect(json).toEqual({
      success: false,
      error: "FX3 1 already scanned",
      errorCode: "duplicate",
    });
    expect(mocks.scanEventCreate).not.toHaveBeenCalled();
    expect(mocks.badgeOnScanResult).not.toHaveBeenCalled();
  });

  it("returns duplicate feedback for a serialized item handed over in an earlier partial pickup", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "reservation-1",
      status: "BOOKED",
      kind: "RESERVATION",
      requesterUserId: "user-1",
      locationId: "loc-1",
    });
    mocks.findAssetByScanValue.mockResolvedValue({
      id: "asset-1",
      assetTag: "FX3 1",
      name: "FX3 1",
    });
    mocks.bookingSerializedItemFindUnique.mockResolvedValue({
      id: "serialized-1",
      bookingId: "reservation-1",
      assetId: "asset-1",
      allocationStatus: "picked_up",
    });

    const res = await scanKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ scanValue: "23723854" }),
    }), routeCtx("reservation-1"));

    expect(await res.json()).toEqual({
      success: false,
      error: "FX3 1 already picked up",
      errorCode: "duplicate",
    });
    expect(mocks.scanEventFindFirst).not.toHaveBeenCalled();
    expect(mocks.scanEventCreate).not.toHaveBeenCalled();
  });

  it("blocks pickup confirmation until all serialized items are scanned", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Pickup",
      requesterUserId: "user-1",
      serializedItems: [{
        assetId: "asset-1",
        asset: { assetTag: "FX3 1", name: "FX3 1" },
      }],
      scanEvents: [],
      bulkItems: [],
    });

    await expect(confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("booking-1"))).rejects.toThrow("Scan FX3 1 before confirming pickup");

    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it("allows pickup confirmation after serialized items are scanned", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Pickup",
      requesterUserId: "user-1",
      serializedItems: [{
        assetId: "asset-1",
        asset: { assetTag: "FX3 1", name: "FX3 1" },
      }],
      scanEvents: [{ assetId: "asset-1", phase: "CHECKOUT" }],
      bulkItems: [],
    });
    mocks.createAuditEntryTx.mockResolvedValue({});

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("booking-1"));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mocks.bookingUpdateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "PENDING_PICKUP" },
      data: { status: "OPEN", pickupKioskDeviceId: "kiosk-1" },
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorId: "user-1",
      action: "kiosk_pickup",
      after: expect.objectContaining({
        status: "OPEN",
        source: "KIOSK",
        kioskDeviceId: "kiosk-1",
      }),
    }));
    expect(mocks.badgeOnCheckoutOpened).toHaveBeenCalledWith({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_pickup",
      sourceKey: "booking-1",
    });
  });

  it("rejects a stale owner after a pre-open transfer", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-old", name: "Old Owner", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Transferred pickup",
      requesterUserId: "user-new",
      serializedItems: [],
      scanEvents: [],
      bulkItems: [],
    });

    await expect(confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-old" }),
    }), routeCtx("booking-1"))).rejects.toThrow(
      "Only the current checkout owner can confirm pickup at the kiosk",
    );

    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
  });

  it("blocks stale repeated pickup confirmation after another request opens it", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Pickup",
      requesterUserId: "user-1",
      serializedItems: [{
        assetId: "asset-1",
        asset: { assetTag: "FX3 1", name: "FX3 1" },
      }],
      scanEvents: [{ assetId: "asset-1", phase: "CHECKOUT" }],
      bulkItems: [],
    });
    mocks.bookingUpdateMany.mockResolvedValue({ count: 0 });

    await expect(confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("booking-1"))).rejects.toThrow("Pickup was already confirmed. Refresh this checkout.");

    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
  });
});

describe("kiosk pickup confirm bulk guard", () => {
  it("blocks pickup confirmation until all planned battery units are scanned", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Pickup",
      requesterUserId: "user-1",
      serializedItems: [],
      scanEvents: [],
      bulkItems: [{
        plannedQuantity: 3,
        checkedOutQuantity: 2,
        bulkSku: { name: "Sony Battery", trackByNumber: true },
      }],
    });

    await expect(confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("booking-1"))).rejects.toThrow("Scan all Sony Battery units before confirming pickup");

    expect(mocks.bookingUpdateMany).not.toHaveBeenCalled();
  });

  it("allows quantity-tracked pickup confirmation without fake per-unit scans", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      status: "PENDING_PICKUP",
      kind: "CHECKOUT",
      title: "Pickup",
      requesterUserId: "user-1",
      serializedItems: [],
      scanEvents: [],
      bulkItems: [{
        plannedQuantity: 1_000_000,
        checkedOutQuantity: 0,
        bulkSku: { name: "Gaffer Tape", trackByNumber: false },
      }],
    });

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("booking-1"));

    expect((await res.json()).success).toBe(true);
    expect(mocks.bookingUpdateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "PENDING_PICKUP" },
      data: { status: "OPEN", pickupKioskDeviceId: "kiosk-1" },
    });
  });
});

describe("kiosk reservation pickup confirmation", () => {
  it("opens a shared reservation for a different identified operator without badge ownership", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "operator-1",
      name: "Operator",
      role: "STAFF",
      active: true,
      hiddenFromRoster: false,
    });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        custodyScope: "SHARED",
        title: "Football Travel Case",
        requesterUserId: "creator-1",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        custodyScope: "SHARED",
        title: "Football Travel Case",
        requesterUserId: "creator-1",
        locationId: "loc-1",
        startsAt: new Date("2026-09-03T21:00:00.000Z"),
        endsAt: new Date("2026-09-07T21:00:00.000Z"),
        notes: null,
        eventId: "event-1",
        sportCode: "FB",
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [{
          assetId: "asset-1",
          allocationStatus: "active",
          asset: { assetTag: "FB FX3 1", name: "FB FX3 1" },
        }],
        bulkItems: [],
        scanEvents: [{
          assetId: "asset-1",
          bulkSkuId: null,
          scanType: "SERIALIZED",
          scanValue: "FB-FX3-1",
        }],
        derivedCheckouts: [],
        events: [{ eventId: "event-1" }],
      });

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "operator-1" }),
    }), routeCtx("reservation-1"));

    expect(res.status).toBe(200);
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      custodyScope: "SHARED",
      requesterUserId: "creator-1",
      createdBy: "operator-1",
    }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "operator-1",
    }));
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
    expect(mocks.earnedBadgesSince).not.toHaveBeenCalled();
  });

  it("creates a linked open checkout after all reservation scans are staged", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        requesterUserId: "user-1",
        locationId: "loc-1",
        startsAt: new Date("2026-06-18T16:00:00.000Z"),
        endsAt: new Date("2026-06-18T20:00:00.000Z"),
        notes: "Bring batteries",
        eventId: "event-1",
        sportCode: "MBB",
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [{
          assetId: "asset-1",
          asset: { assetTag: "FX3 1", name: "FX3 1" },
        }],
        bulkItems: [],
        scanEvents: [{
          assetId: "asset-1",
          bulkSkuId: null,
          scanType: "SERIALIZED",
          scanValue: "FX3-1",
        }],
        events: [{ eventId: "event-1" }],
      });

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("reservation-1"));
    const json = await res.json();

    expect(json).toEqual({ success: true, bookingId: "checkout-1" });
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      kind: "CHECKOUT",
      custodySource: "KIOSK",
      title: "Camera reservation",
      requesterUserId: "user-1",
      locationId: "loc-1",
      sourceReservationId: "reservation-1",
      eventIds: ["event-1"],
    }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "kiosk_pickup",
      entityId: "checkout-1",
      after: expect.objectContaining({
        status: "OPEN",
        sourceReservationId: "reservation-1",
        kioskDeviceId: "kiosk-1",
      }),
    }));
    expect(mocks.badgeOnCheckoutOpened).toHaveBeenCalledWith({
      userId: "user-1",
      bookingId: "checkout-1",
      source: "kiosk_pickup",
      sourceKey: "reservation-1",
    });
  });

  it("creates a linked checkout for only the scanned reservation items when pickup is partial", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        requesterUserId: "user-1",
        locationId: "loc-1",
        startsAt: new Date("2026-06-18T16:00:00.000Z"),
        endsAt: new Date("2026-06-18T20:00:00.000Z"),
        notes: null,
        eventId: null,
        sportCode: null,
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [
          {
            assetId: "asset-1",
            allocationStatus: "active",
            asset: { assetTag: "FX3 1", name: "Camera 1" },
          },
          {
            assetId: "asset-2",
            allocationStatus: "active",
            asset: { assetTag: "FX3 2", name: "Camera 2" },
          },
        ],
        bulkItems: [],
        scanEvents: [{
          assetId: "asset-1",
          bulkSkuId: null,
          scanType: "SERIALIZED",
          scanValue: "FX3-1",
        }],
        derivedCheckouts: [],
        events: [],
      });

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1", partial: true }),
    }), routeCtx("reservation-1"));
    const json = await res.json();

    expect(json).toEqual({ success: true, bookingId: "checkout-1", partial: true });
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      sourceReservationId: "reservation-1",
      sourceReservationPickup: true,
      serializedAssetIds: ["asset-1"],
      bulkItems: [],
      bulkUnitItems: [],
    }));
  });

  it("creates a linked checkout for quantity-tracked stock without per-unit scans", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Supply reservation",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Supply reservation",
        requesterUserId: "user-1",
        locationId: "loc-1",
        startsAt: new Date("2026-06-18T16:00:00.000Z"),
        endsAt: new Date("2026-06-18T20:00:00.000Z"),
        notes: null,
        eventId: null,
        sportCode: null,
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [],
        bulkItems: [{
          bulkSkuId: "sku-tape",
          plannedQuantity: 1_000_000,
          bulkSku: {
            id: "sku-tape",
            name: "Gaffer Tape",
            binQrCodeValue: "TAPE",
            trackByNumber: false,
          },
        }],
        scanEvents: [],
        events: [],
      });

    const res = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("reservation-1"));

    expect((await res.json()).bookingId).toBe("checkout-1");
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      sourceReservationId: "reservation-1",
      bulkUnitItems: [],
    }));
  });

  it("allows reservation pickup at another kiosk location", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        requesterUserId: "user-1",
        locationId: "loc-other",
        startsAt: new Date("2026-06-18T16:00:00.000Z"),
        endsAt: new Date("2026-06-18T20:00:00.000Z"),
        notes: null,
        eventId: null,
        sportCode: null,
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [{
          assetId: "asset-1",
          allocationStatus: "active",
          asset: { assetTag: "FX3 1", name: "Camera" },
        }],
        bulkItems: [],
        scanEvents: [{
          assetId: "asset-1",
          bulkSkuId: null,
          scanType: "SERIALIZED",
          scanValue: "FX3-1",
        }],
        events: [],
      });

    const response = await confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("reservation-1"));

    expect(response.status).toBe(200);
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({ locationId: "loc-other" }));
    expect(mocks.badgeOnCheckoutOpened).toHaveBeenCalledOnce();
  });

  it("does not audit or badge when linked checkout creation conflicts", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", name: "User", role: "STUDENT" });
    mocks.bookingFindUnique
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        serializedItems: [],
        scanEvents: [],
        bulkItems: [],
      })
      .mockResolvedValueOnce({
        id: "reservation-1",
        status: "BOOKED",
        kind: "RESERVATION",
        title: "Camera reservation",
        requesterUserId: "user-1",
        locationId: "loc-1",
        startsAt: new Date("2026-06-18T16:00:00.000Z"),
        endsAt: new Date("2026-06-18T20:00:00.000Z"),
        notes: null,
        eventId: null,
        sportCode: null,
        shiftAssignmentId: null,
        kitId: null,
        serializedItems: [{
          assetId: "asset-1",
          allocationStatus: "active",
          asset: { assetTag: "FX3 1", name: "Camera" },
        }],
        bulkItems: [],
        scanEvents: [{
          assetId: "asset-1",
          bulkSkuId: null,
          scanType: "SERIALIZED",
          scanValue: "FX3-1",
        }],
        events: [],
      });
    mocks.createBooking.mockRejectedValue(new Error("Availability conflict"));

    await expect(confirmKioskPickup(new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ actorId: "user-1" }),
    }), routeCtx("reservation-1"))).rejects.toThrow("Availability conflict");

    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
    expect(mocks.badgeOnCheckoutOpened).not.toHaveBeenCalled();
  });
});
