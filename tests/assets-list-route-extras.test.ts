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
  bulkSkuUnitGroupBy: vi.fn(),
  bulkSkuUnitFindMany: vi.fn(),
  bookingSerializedItemFindMany: vi.fn(),
  bookingBulkItemFindMany: vi.fn(),
  scanEventFindMany: vi.fn(),
  queryRaw: vi.fn(),
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
    bulkSkuUnit: {
      groupBy: mocks.bulkSkuUnitGroupBy,
      findMany: mocks.bulkSkuUnitFindMany,
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
    $queryRaw: mocks.queryRaw,
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

vi.mock("@/lib/services/damage-cases", () => ({
  missingAssetIds: vi.fn(async () => new Set<string>()),
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

function mockNumberedFamilyCounts(sku: ReturnType<typeof numberedBatterySku>) {
  const units = sku.units as Array<{ status: string }>;
  mocks.bulkSkuUnitGroupBy.mockImplementation(async (args: { by?: string[] }) => {
    if (!args.by?.includes("status")) return [];
    const counts = new Map<string, number>();
    for (const unit of units) counts.set(unit.status, (counts.get(unit.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, count]) => ({
      bulkSkuId: sku.id,
      status,
      _count: { _all: count },
    }));
  });
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
  mocks.bulkSkuUnitGroupBy.mockResolvedValue([]);
  mocks.bulkSkuUnitFindMany.mockResolvedValue([]);
  mocks.bookingSerializedItemFindMany.mockResolvedValue([]);
  mocks.bookingBulkItemFindMany.mockResolvedValue([]);
  mocks.scanEventFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([]);
});

const getContext = { params: Promise.resolve({}) };

function booking(id: string, kind: string, status: string, endsAt: Date) {
  return { id, kind, status, title: `Booking ${id}`, endsAt, requester: { name: "Grace", avatarUrl: null } };
}

describe("/api/assets active bookings", () => {
  it("attaches the booking that explains each held item, and flags overdue checkouts", async () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 86_400_000);
    mocks.assetFindMany.mockResolvedValue([
      { ...assetRow("a-out", "ROAM2"), computedStatus: "CHECKED_OUT" },
      { ...assetRow("a-pickup", "SLOW1"), computedStatus: "PENDING_PICKUP" },
      { ...assetRow("a-reserved", "FX6 1"), computedStatus: "RESERVED" },
      { ...assetRow("a-free", "FX6 2"), computedStatus: "AVAILABLE" },
    ]);
    mocks.assetCount.mockResolvedValue(4);
    mocks.assetAllocationFindMany.mockResolvedValue([
      // A future reservation on the checked-out item doesn't explain why it's out.
      { assetId: "a-out", startsAt: past, booking: booking("r-later", "RESERVATION", "BOOKED", future) },
      { assetId: "a-out", startsAt: past, booking: booking("c-queued", "CHECKOUT", "PENDING_PICKUP", future) },
      { assetId: "a-out", startsAt: past, booking: booking("c-open", "CHECKOUT", "OPEN", past) },
      { assetId: "a-pickup", startsAt: past, booking: booking("c-pickup", "CHECKOUT", "PENDING_PICKUP", future) },
      { assetId: "a-pickup", startsAt: past, booking: booking("c-pickup-2", "CHECKOUT", "PENDING_PICKUP", future) },
      { assetId: "a-reserved", startsAt: future, booking: booking("r-future", "RESERVATION", "BOOKED", future) },
    ]);

    const body = await (await getAssets(request("/api/assets?item_type=serialized"), getContext)).json();
    const byId = Object.fromEntries((body.data as Array<{ id: string; activeBooking: { id: string; isOverdue: boolean } | null }>).map((row) => [row.id, row.activeBooking]));

    expect(byId["a-out"]).toEqual(expect.objectContaining({ id: "c-open", isOverdue: true, requesterName: "Grace" }));
    expect(byId["a-pickup"]).toEqual(expect.objectContaining({ id: "c-pickup", isOverdue: false }));
    expect(byId["a-reserved"]).toBeNull();
    expect(byId["a-free"]).toBeNull();
    const lookedUp = mocks.assetAllocationFindMany.mock.calls[0]?.[0].where.assetId.in as string[];
    expect([...lookedUp].sort()).toEqual(["a-out", "a-pickup", "a-reserved"]);
  });

  it("skips the booking lookup when nothing is held", async () => {
    mocks.assetFindMany.mockResolvedValue([assetRow("a-free", "FX6 2")]);
    mocks.assetCount.mockResolvedValue(1);

    await getAssets(request("/api/assets?item_type=serialized"), getContext);

    expect(mocks.assetAllocationFindMany).not.toHaveBeenCalled();
  });
});

describe("/api/assets for collaborators", () => {
  const collaborator = { ...authedUser, id: "collab-1", role: "COLLABORATOR", capabilities: ["GEAR_CATALOG_VIEW"] };

  it("hides who holds gear and reports only available versus unavailable", async () => {
    mocks.requireAuth.mockResolvedValue(collaborator);
    mocks.assetFindMany.mockResolvedValue([
      { ...assetRow("a-out", "ROAM2"), computedStatus: "CHECKED_OUT" },
      assetRow("a-free", "FX6 2"),
    ]);
    mocks.assetCount.mockResolvedValue(2);

    const battery = numberedBatterySku();
    mocks.bulkSkuFindMany.mockResolvedValue([battery]);
    mockNumberedFamilyCounts(battery);

    const body = await (await getAssets(request("/api/assets?sort=assetTag"), getContext)).json();

    expect(mocks.assetAllocationFindMany).not.toHaveBeenCalled();
    expect(body.bulkItems).toEqual([expect.objectContaining({ id: "sku-battery", kind: "bulk" })]);
    expect(body.availabilityBreakdown).toEqual({ available: 2, unavailable: 1 });
    expect(body.statusBreakdown).toBeUndefined();
    const rows = body.data as Array<{ id: string; availability: string; activeBooking: unknown; serialNumber?: unknown }>;
    expect(rows.map((row) => [row.id, row.availability, row.activeBooking, row.serialNumber]).sort()).toEqual([
      ["a-free", "AVAILABLE", null, undefined],
      ["a-out", "UNAVAILABLE", null, undefined],
    ]);
  });

  it("shows team gear holders to collaborators allowed to see them", async () => {
    mocks.requireAuth.mockResolvedValue({ ...collaborator, capabilities: ["GEAR_CATALOG_VIEW", "TEAM_GEAR_VIEW"] });
    mocks.assetFindMany.mockResolvedValue([{ ...assetRow("a-out", "ROAM2"), computedStatus: "CHECKED_OUT" }]);
    mocks.assetCount.mockResolvedValue(1);
    mocks.assetAllocationFindMany.mockResolvedValue([
      { assetId: "a-out", startsAt: new Date(), booking: booking("c-open", "CHECKOUT", "OPEN", new Date(Date.now() + 86_400_000)) },
    ]);

    const body = await (await getAssets(request("/api/assets?item_type=serialized"), getContext)).json();

    expect(body.data[0].activeBooking).toEqual(expect.objectContaining({ id: "c-open" }));
  });
});

describe("/api/assets sorting", () => {
  it("sorts serialized items by recent use, breaking ties by tag, and reverses on request", async () => {
    mocks.assetFindMany.mockResolvedValue([assetRow("a-1", "FX6 1"), assetRow("a-2", "FX6 2"), assetRow("a-3", "FX6 3")]);
    mocks.assetCount.mockResolvedValue(3);
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => (
      strings.join("").includes("booking_serialized_items")
        ? [{ asset_id: "a-3", weight: 10, last_activity: new Date() }]
        : []
    ));

    const popular = await (await getAssets(request("/api/assets?item_type=serialized&sort=popular"), getContext)).json();
    expect(popular.data.map((row: { id: string }) => row.id)).toEqual(["a-3", "a-1", "a-2"]);
    expect(popular.total).toBe(3);

    const reversed = await (await getAssets(request("/api/assets?item_type=serialized&sort=-popular"), getContext)).json();
    expect(reversed.data.map((row: { id: string }) => row.id)).toEqual(["a-2", "a-1", "a-3"]);
  });

  it("lists item families alone by name, and by tag order across the unified list when asked", async () => {
    mocks.bulkSkuFindMany.mockResolvedValue([
      numberedBatterySku({ id: "sku-b", name: "B Battery", units: [] }),
      numberedBatterySku({ id: "sku-a", name: "A Battery", units: [] }),
    ]);

    const ascending = await (await getAssets(request("/api/assets?item_type=bulk"), getContext)).json();
    expect(ascending.bulkItems.map((row: { id: string }) => row.id)).toEqual(["sku-a", "sku-b"]);
    expect(ascending.total).toBe(2);
    expect(mocks.assetFindMany).not.toHaveBeenCalled();

    const descending = await (await getAssets(request("/api/assets?item_type=bulk&sort=-assetTag&limit=1"), getContext)).json();
    expect(descending.bulkItems.map((row: { id: string }) => row.id)).toEqual(["sku-b"]);
    expect(descending.statusBreakdown.available).toBe(2);
  });
});
