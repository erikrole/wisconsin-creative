import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assetFindMany: vi.fn(),
  assetCount: vi.fn(),
  assetAllocationFindMany: vi.fn(),
  favoriteItemFindMany: vi.fn(),
  favoriteItemFamilyFindMany: vi.fn(),
  bulkSkuFindMany: vi.fn(),
  bookingBulkUnitAllocationFindMany: vi.fn(),
  bookingSerializedItemFindMany: vi.fn(),
  bookingBulkItemFindMany: vi.fn(),
  scanEventFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    asset: {
      findMany: mocks.assetFindMany,
      count: mocks.assetCount,
    },
    assetAllocation: {
      findMany: mocks.assetAllocationFindMany,
    },
    favoriteItem: {
      findMany: mocks.favoriteItemFindMany,
    },
    favoriteItemFamily: {
      findMany: mocks.favoriteItemFamilyFindMany,
    },
    bulkSku: {
      findMany: mocks.bulkSkuFindMany,
    },
    bookingBulkUnitAllocation: {
      findMany: mocks.bookingBulkUnitAllocationFindMany,
    },
    bookingSerializedItem: {
      findMany: mocks.bookingSerializedItemFindMany,
    },
    bookingBulkItem: {
      findMany: mocks.bookingBulkItemFindMany,
    },
    scanEvent: {
      findMany: mocks.scanEventFindMany,
    },
  },
}));

vi.mock("@/lib/services/status", () => ({
  buildDerivedStatusWhere: vi.fn((statuses: string[]) => statuses.map((status) => ({ status }))),
  enrichAssetsWithStatusFromLoaded: vi.fn(async (assets: unknown[]) => assets),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { GET as getAssets } from "@/app/api/assets/route";

const authedUser = {
  id: "user-1",
  email: "staff@example.com",
  name: "Staff",
  role: "STAFF",
  avatarUrl: null,
  forcePasswordChange: false,
};

function request(path: string) {
  return new Request(`https://gear.test${path}`);
}

function numberedBatterySku(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku-battery",
    name: "Sony Battery",
    category: "Batteries",
    unit: "each",
    trackByNumber: true,
    imageUrl: null,
    locationId: "loc-1",
    categoryId: "cat-1",
    categoryRel: { id: "cat-1", name: "Batteries" },
    departmentId: "dept-1",
    binQrCodeValue: "BAT",
    location: { name: "Cage" },
    department: { id: "dept-1", name: "Production" },
    balances: [{ onHandQuantity: 46 }],
    units: [
      ...Array.from({ length: 43 }, (_, index) => ({ id: `unit-${index + 1}`, unitNumber: index + 1, status: "AVAILABLE" })),
      { id: "unit-44", unitNumber: 44, status: "CHECKED_OUT" },
      { id: "unit-45", unitNumber: 45, status: "CHECKED_OUT" },
      { id: "unit-46", unitNumber: 46, status: "LOST" },
    ],
    ...overrides,
  };
}

function assetRow(id: string, assetTag: string) {
  return {
    id,
    assetTag,
    name: null,
    type: "Lens",
    brand: "Sony",
    model: assetTag,
    serialNumber: null,
    qrCodeValue: `QR-${id}`,
    primaryScanCode: `SCAN-${id}`,
    purchaseDate: null,
    purchasePrice: null,
    warrantyDate: null,
    residualValue: null,
    locationId: "loc-1",
    departmentId: "dept-1",
    categoryId: "cat-1",
    status: "AVAILABLE",
    computedStatus: "AVAILABLE",
    consumable: false,
    availableForReservation: true,
    availableForCheckout: true,
    availableForCustody: true,
    linkUrl: null,
    imageUrl: null,
    imageRehostAttempts: 0,
    uwAssetTag: null,
    notes: null,
    sourcePayload: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    parentAssetId: null,
    location: { id: "loc-1", name: "Camp Randall" },
    category: { id: "cat-1", name: "Lenses" },
    department: { id: "dept-1", name: "Creative" },
    _count: { accessories: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authedUser);
  mocks.assetFindMany.mockResolvedValue([]);
  mocks.assetCount.mockResolvedValue(0);
  mocks.assetAllocationFindMany.mockResolvedValue([]);
  mocks.favoriteItemFindMany.mockResolvedValue([]);
  mocks.favoriteItemFamilyFindMany.mockResolvedValue([]);
  mocks.bulkSkuFindMany.mockResolvedValue([]);
  mocks.bookingBulkUnitAllocationFindMany.mockResolvedValue([]);
  mocks.bookingSerializedItemFindMany.mockResolvedValue([]);
  mocks.bookingBulkItemFindMany.mockResolvedValue([]);
  mocks.scanEventFindMany.mockResolvedValue([]);
});

describe("/api/assets item-family rows", () => {
  it("uses one sorted page across serialized assets and item families", async () => {
    mocks.assetFindMany.mockResolvedValue([
      assetRow("16-35-1", "16-35 1"),
      assetRow("24-70-1", "24-70 1"),
      assetRow("35-150-1", "35-150 1"),
      assetRow("50-500-1", "50-500 1"),
      assetRow("70-macro-1", "70 macro 1"),
      assetRow("mbb-70-180-1", "MBB 70-180 1"),
      assetRow("70-200-1", "70-200 1"),
      assetRow("100-400-1", "100-400 1"),
    ]);
    mocks.assetCount.mockResolvedValue(8);
    mocks.bulkSkuFindMany.mockResolvedValue([
      numberedBatterySku({ id: "sku-anton", name: "Anton Bauer Digital 150 Gold-Mount Battery" }),
    ]);

    const pageOne = await getAssets(request("/api/assets?sort=assetTag&limit=5&offset=0"), {
      params: Promise.resolve({}),
    });
    const pageOneBody = await pageOne.json();

    expect(pageOne.status).toBe(200);
    expect(pageOneBody.total).toBe(9);
    expect(pageOneBody.data.map((asset: { assetTag: string }) => asset.assetTag)).toEqual([
      "16-35 1",
      "24-70 1",
      "35-150 1",
      "50-500 1",
      "70 macro 1",
    ]);
    expect(pageOneBody.bulkItems).toEqual([]);

    const pageTwo = await getAssets(request("/api/assets?sort=assetTag&limit=5&offset=5"), {
      params: Promise.resolve({}),
    });
    const pageTwoBody = await pageTwo.json();

    expect(pageTwo.status).toBe(200);
    expect(pageTwoBody.data.map((asset: { assetTag: string }) => asset.assetTag)).toEqual([
      "MBB 70-180 1",
      "70-200 1",
      "100-400 1",
    ]);
    expect(pageTwoBody.bulkItems).toMatchObject([
      { id: "sku-anton", name: "Anton Bauer Digital 150 Gold-Mount Battery" },
    ]);
  });

  it("applies item-family kind filters at the API layer", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([numberedBatterySku()]);

    const res = await getAssets(request("/api/assets?item_type=unit-tracked&limit=25"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.total).toBe(1);
    expect(body.statusBreakdown).toMatchObject({ available: 1, checkedOut: 0, retired: 0 });
    expect(body.bulkItems).toMatchObject([{ id: "sku-battery", trackByNumber: true }]);
    expect(mocks.assetFindMany).not.toHaveBeenCalled();
    expect(mocks.bulkSkuFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ active: true, trackByNumber: true }),
    }));
  });

  it("returns item-family favorite state and allows favorites-only family filtering", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([numberedBatterySku()]);
    mocks.favoriteItemFamilyFindMany.mockResolvedValue([{ bulkSkuId: "sku-battery" }]);

    const res = await getAssets(request("/api/assets?item_type=unit-tracked&favorites_only=true&limit=25"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bulkItems).toMatchObject([
      { id: "sku-battery", isFavorited: true },
    ]);
    expect(body.total).toBe(1);
    expect(mocks.bulkSkuFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        trackByNumber: true,
        favoritedBy: { some: { userId: "user-1" } },
      }),
    }));
  });

  it("expands compact family search aliases for item-family names", async () => {
    await getAssets(request("/api/assets?q=70200&limit=25"), {
      params: Promise.resolve({}),
    });

    expect(mocks.bulkSkuFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { name: { contains: "70-200", mode: "insensitive" } },
        ]),
      }),
    }));
  });

  it("paginates asset-tag sorting by operational tag family", async () => {
    mocks.assetFindMany.mockResolvedValue([
      assetRow("fx6-1", "FX6 1"),
      assetRow("fb-70-200-2", "FB 70-200 2"),
      assetRow("fx3-2", "FX3 2"),
      assetRow("mbb-28-75-1", "MBB 28-75 1"),
      assetRow("70-200-1", "70-200 1"),
      assetRow("70-200-2", "70-200 2"),
      assetRow("fb-16-35-1", "FB 16-35 1"),
      assetRow("fb-70-200-1", "FB 70-200 1"),
      assetRow("fb-fx3-1", "FB FX3 1"),
      assetRow("video-assist-1", "Video Assist 1"),
      assetRow("video-fx6-2", "Video FX6 2"),
    ]);
    mocks.assetCount.mockResolvedValue(11);

    const res = await getAssets(request("/api/assets?sort=assetTag&limit=10&offset=0"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((asset: { assetTag: string }) => asset.assetTag)).toEqual([
      "FB 16-35 1",
      "MBB 28-75 1",
      "70-200 1",
      "70-200 2",
      "FB 70-200 1",
      "FB 70-200 2",
      "FX3 2",
      "FB FX3 1",
      "FX6 1",
      "Video FX6 2",
    ]);
    expect(body.total).toBe(11);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { assetTag: "asc" },
    }));
  });

  it("sorts serialized assets and item families by recent popularity with asset-tag tie breaks", async () => {
    const camera = assetRow("camera-1", "FX3 1");
    const lens = assetRow("lens-1", "70-200 1");
    const tripod = assetRow("tripod-1", "Tripod 1");
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    mocks.assetFindMany.mockResolvedValue([tripod, lens, camera]);
    mocks.assetCount.mockResolvedValue(3);
    mocks.bulkSkuFindMany.mockResolvedValue([
      numberedBatterySku({ id: "sku-battery", name: "Sony Battery" }),
      numberedBatterySku({ id: "sku-card", name: "SanDisk Card", trackByNumber: false, units: [], balances: [{ onHandQuantity: 8 }] }),
    ]);
    mocks.bookingSerializedItemFindMany.mockResolvedValue([
      {
        assetId: "camera-1",
        createdAt: daysAgo(1),
        booking: { kind: "CHECKOUT", startsAt: daysAgo(1) },
      },
      {
        assetId: "lens-1",
        createdAt: daysAgo(2),
        booking: { kind: "RESERVATION", startsAt: daysAgo(2) },
      },
    ]);
    mocks.bookingBulkItemFindMany.mockResolvedValue([
      {
        bulkSkuId: "sku-battery",
        plannedQuantity: 2,
        createdAt: daysAgo(3),
        booking: { kind: "CHECKOUT", startsAt: daysAgo(3) },
      },
    ]);
    mocks.scanEventFindMany
      .mockResolvedValueOnce([{ assetId: "tripod-1", createdAt: daysAgo(4) }])
      .mockResolvedValueOnce([{ bulkSkuId: "sku-card", createdAt: daysAgo(4) }]);

    const omitted = await getAssets(request("/api/assets?limit=5"), {
      params: Promise.resolve({}),
    });
    const omittedBody = await omitted.json();
    expect(omitted.status).toBe(200);
    expect(omittedBody.itemOrder).toEqual([
      "bulk-sku-battery",
      "camera-1",
      "lens-1",
      "bulk-sku-card",
      "tripod-1",
    ]);

    const res = await getAssets(request("/api/assets?sort=popular&limit=5"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.itemOrder).toEqual([
      "bulk-sku-battery",
      "camera-1",
      "lens-1",
      "bulk-sku-card",
      "tripod-1",
    ]);
    expect(body.data.map((asset: { assetTag: string }) => asset.assetTag)).toEqual([
      "FX3 1",
      "70-200 1",
      "Tripod 1",
    ]);
    expect(body.bulkItems.map((item: { name: string }) => item.name)).toEqual([
      "Sony Battery",
      "SanDisk Card",
    ]);
  });

  it("excludes retired serialized rows from the default list", async () => {
    const res = await getAssets(request("/api/assets?limit=25"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { parentAssetId: null },
          { status: { not: "RETIRED" } },
        ],
      },
    }));
    expect(mocks.assetCount).toHaveBeenCalledWith({
      where: {
        AND: [
          { parentAssetId: null },
          { status: { not: "RETIRED" } },
        ],
      },
    });
  });

  it("hides parented accessories from default and text-search lists", async () => {
    const res = await getAssets(request("/api/assets?q=fx3&limit=25"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          expect.objectContaining({ parentAssetId: null }),
          { status: { not: "RETIRED" } },
        ],
      },
    }));
    expect(mocks.assetCount).toHaveBeenCalledWith({
      where: {
        AND: [
          expect.objectContaining({ parentAssetId: null }),
          { status: { not: "RETIRED" } },
        ],
      },
    });
  });

  it("keeps direct QR lookup able to find parented accessories", async () => {
    const res = await getAssets(request("/api/assets?qr=FX3-HANDLE-1&limit=5"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { qrCodeValue: { equals: "FX3-HANDLE-1", mode: "insensitive" } },
        ]),
      }),
    }));
    expect(mocks.assetFindMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ parentAssetId: null }),
    }));
  });

  it("keeps retired rows available through an explicit Retired status filter", async () => {
    const res = await getAssets(request("/api/assets?status=RETIRED&limit=25"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { parentAssetId: null },
          { OR: [{ status: "RETIRED" }] },
        ],
      },
    }));
    expect(mocks.bulkSkuFindMany).not.toHaveBeenCalled();
  });

  it("returns one unit-tracked item-family row with availability counts for search", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([numberedBatterySku()]);

    const res = await getAssets(request("/api/assets?q=battery&limit=25"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.bulkItems).toMatchObject([
      {
        id: "sku-battery",
        kind: "bulk",
        name: "Sony Battery",
        category: "Batteries",
        trackByNumber: true,
        availableQuantity: 45,
        onHandQuantity: 46,
        checkedOutQuantity: 0,
        lostQuantity: 1,
        retiredQuantity: 0,
        locationName: "Cage",
        departmentName: "Production",
      },
    ]);
  });

  it("uses the canonical category relation for item-family display", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([
      numberedBatterySku({
        category: "Recording Equipment",
        categoryRel: { id: "cat-1", name: "Batteries" },
      }),
    ]);

    const res = await getAssets(request("/api/assets?q=battery&limit=25"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bulkItems[0]).toMatchObject({
      id: "sku-battery",
      category: "Batteries",
      categoryId: "cat-1",
    });
  });

  it("resolves a derived unit QR to the parent item family with unit status", async () => {
    mocks.bulkSkuFindMany
      .mockResolvedValueOnce([
        { id: "sku-battery", binQrCodeValue: "BAT", trackByNumber: true },
      ])
      .mockResolvedValueOnce([numberedBatterySku()]);

    const res = await getAssets(request("/api/assets?qr=BAT-44&limit=5"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.bulkItems).toHaveLength(1);
    expect(body.bulkItems[0]).toMatchObject({
      id: "sku-battery",
      name: "Sony Battery",
      trackByNumber: true,
      matchedUnitNumber: 44,
      matchedUnitStatus: "AVAILABLE",
      availableQuantity: 45,
      checkedOutQuantity: 0,
      onHandQuantity: 46,
    });
    expect(body.bulkItems[0].units).toEqual(expect.arrayContaining([
      { unitNumber: 44, status: "AVAILABLE" },
      { unitNumber: 45, status: "AVAILABLE" },
      { unitNumber: 46, status: "LOST" },
    ]));
    expect(mocks.bookingBulkUnitAllocationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        bulkSkuUnitId: { in: expect.arrayContaining(["unit-44"]) },
      }),
    }));
  });

  it("includes custody context when an exact unit QR is checked out", async () => {
    mocks.bulkSkuFindMany
      .mockResolvedValueOnce([
        { id: "sku-battery", binQrCodeValue: "BAT", trackByNumber: true },
      ])
      .mockResolvedValueOnce([numberedBatterySku()]);
    mocks.bookingBulkUnitAllocationFindMany.mockResolvedValue([{
      bulkSkuUnitId: "unit-44",
      bookingBulkItem: {
        booking: {
          id: "booking-1",
          title: "Minnesota travel kit",
          endsAt: new Date("2026-05-16T18:00:00.000Z"),
          requester: { name: "Taylor Student", avatarUrl: null },
        },
      },
    }]);

    const res = await getAssets(request("/api/assets?qr=BAT-44&limit=5"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.bulkItems[0]).toMatchObject({
      id: "sku-battery",
      matchedUnitNumber: 44,
      matchedUnitStatus: "CHECKED_OUT",
      availableQuantity: 44,
      checkedOutQuantity: 1,
      matchedUnitHolder: "Taylor Student",
      matchedUnitDueAt: "2026-05-16T18:00:00.000Z",
      matchedUnitBookingTitle: "Minnesota travel kit",
      matchedUnitBookingId: "booking-1",
    });
    expect(body.bulkItems[0].units).toEqual(expect.arrayContaining([
      { unitNumber: 44, status: "CHECKED_OUT" },
      { unitNumber: 45, status: "AVAILABLE" },
    ]));
  });

  it("returns mixed serialized and item-family ids for select-all matching", async () => {
    mocks.assetFindMany.mockResolvedValue([{ id: "asset-1" }]);
    mocks.bulkSkuFindMany.mockResolvedValue([{ id: "sku-battery" }]);

    const res = await getAssets(request("/api/assets?ids_only=true"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ids).toEqual(["asset-1", "bulk-sku-battery"]);
    expect(body.truncated).toBe(false);
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true },
    }));
    expect(mocks.bulkSkuFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true },
    }));
  });

  it("returns only item-family ids when select-all matching is scoped to units", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([{ id: "sku-battery" }]);

    const res = await getAssets(request("/api/assets?ids_only=true&item_type=unit-tracked"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ids).toEqual(["bulk-sku-battery"]);
    expect(mocks.assetFindMany).not.toHaveBeenCalled();
  });

  it("omits item-family ids when select-all matching is scoped to serialized items", async () => {
    mocks.assetFindMany.mockResolvedValue([{ id: "asset-1" }]);

    const res = await getAssets(request("/api/assets?ids_only=true&item_type=serialized"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ids).toEqual(["asset-1"]);
    expect(mocks.bulkSkuFindMany).not.toHaveBeenCalled();
  });
});
