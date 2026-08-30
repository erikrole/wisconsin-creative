import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkUnitStatus, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bulkSku: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    bookingBulkUnitAllocation: { findMany: vi.fn() },
    bookingBulkItem: { findMany: vi.fn() },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getBatteryOps } from "@/app/api/bulk-skus/batteries/route";

const noParams = { params: Promise.resolve({}) };

function batterySkus(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.bulkSku.findMany>>;
}

function cameraAssets(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.asset.findMany>>;
}

function unitAllocations(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.bookingBulkUnitAllocation.findMany>>;
}

function bookingBulkItems(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.bookingBulkItem.findMany>>;
}

function makeGetRequest(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    id: "staff-1",
    name: "Staff",
    email: "staff@example.com",
    role: Role.STAFF,
    avatarUrl: null,
  });
  vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue(unitAllocations([]));
  vi.mocked(db.bookingBulkItem.findMany).mockResolvedValue(bookingBulkItems([]));
});

describe("battery ops live counts", () => {
  it("returns no-store battery metrics derived from numbered unit status", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(batterySkus([
      {
        id: "sku-battery",
        name: "Sony Battery",
        category: "Batteries",
        trackByNumber: true,
        minThreshold: 4,
        binQrCodeValue: "sony-battery",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-1", name: "Batteries" },
        balances: [{ onHandQuantity: 99 }],
        products: [
          {
            id: "product-1",
            name: "Sony NP-FZ100",
            brand: "Sony",
            model: "NP-FZ100",
            active: true,
            _count: { units: 1 },
          },
        ],
        units: [
          {
            id: "unit-1",
            productId: "product-1",
            unitNumber: 1,
            status: BulkUnitStatus.AVAILABLE,
            notes: null,
            labelPrintedAt: new Date("2026-06-01T00:00:00.000Z"),
            labelPrintedById: "staff-1",
            labelPrintBatchId: "batch-1",
            allocations: [],
          },
          {
            id: "unit-2",
            unitNumber: 2,
            status: BulkUnitStatus.CHECKED_OUT,
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [{
              checkedOutAt: new Date("2026-05-20T12:00:00.000Z"),
              createdAt: new Date("2026-05-20T12:00:00.000Z"),
              bookingBulkItem: {
                booking: {
                  id: "booking-1",
                  title: "Game day",
                  refNumber: "CO-1001",
                  endsAt: new Date("2026-05-31T18:00:00.000Z"),
                  requester: { name: "Bucky Badger" },
                },
              },
            }],
          },
          { id: "unit-3", unitNumber: 3, status: BulkUnitStatus.LOST, notes: null, labelPrintedAt: null, labelPrintedById: null, labelPrintBatchId: null, allocations: [] },
          { id: "unit-4", unitNumber: 4, status: BulkUnitStatus.RETIRED, notes: null, labelPrintedAt: null, labelPrintedById: null, labelPrintBatchId: null, allocations: [] },
        ],
      },
      {
        id: "sku-cable",
        name: "HDMI Cable",
        category: "Cables",
        trackByNumber: true,
        minThreshold: 0,
        binQrCodeValue: "hdmi",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-2", name: "Cables" },
        balances: [{ onHandQuantity: 1 }],
        units: [{ id: "unit-cable", unitNumber: 1, status: BulkUnitStatus.AVAILABLE, notes: null, allocations: [] }],
      },
    ]));
    vi.mocked(db.asset.findMany).mockResolvedValue(cameraAssets([
      {
        brand: "Sony",
        model: "FX3",
        type: "Camera",
        category: { name: "Cameras" },
      },
    ]));
    vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue(unitAllocations([
      {
        bulkSkuUnitId: "unit-2",
        checkedOutAt: new Date("2026-05-20T12:00:00.000Z"),
        createdAt: new Date("2026-05-20T12:00:00.000Z"),
        bookingBulkItem: {
          booking: {
            id: "booking-1",
            title: "Game day",
            refNumber: "CO-1001",
            endsAt: new Date("2026-05-31T18:00:00.000Z"),
            requester: { name: "Bucky Badger" },
          },
        },
      },
    ]));

    const res = await getBatteryOps(makeGetRequest("/api/bulk-skus/batteries"), noParams);
    const body = await res.json();

    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.totals).toEqual({
      total: 4,
      available: 1,
      checkedOut: 1,
      lost: 1,
      retired: 1,
      lowSkus: 1,
      agingCheckedOut: expect.any(Number),
    });
    expect(body.data.skus).toHaveLength(1);
    expect(body.data.skus[0]).toEqual(expect.objectContaining({
      id: "sku-battery",
      trackByNumber: true,
      counts: {
        total: 4,
        available: 1,
        checkedOut: 1,
        lost: 1,
        retired: 1,
      },
      isLow: true,
      threshold: 10,
      labelPrintedCount: 1,
      labelNeededCount: 2,
    }));
    expect(body.data.skus[0].units[0]).toEqual(expect.objectContaining({
      unitNumber: 1,
      productId: "product-1",
      labelPrintedAt: "2026-06-01T00:00:00.000Z",
      labelPrintedById: "staff-1",
      labelPrintBatchId: "batch-1",
    }));
    expect(body.data.skus[0].units[3]).toEqual(expect.objectContaining({
      unitNumber: 4,
      labelPrintedAt: null,
    }));
    expect(body.data.skus[0].products).toEqual([
      {
        id: "product-1",
        name: "Sony NP-FZ100",
        brand: "Sony",
        model: "NP-FZ100",
        assignedUnitCount: 1,
      },
    ]);
    expect(body.data.compatibility[0]).toEqual(expect.objectContaining({
      ruleId: "sony-np-fz100",
      availableQuantity: 1,
      threshold: 10,
      isLow: true,
    }));
  });

  it("includes quantity-tracked battery families with stock-balance counts", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(batterySkus([
      {
        id: "sku-aa",
        name: "AA Batteries",
        category: "Batteries",
        trackByNumber: false,
        minThreshold: 4,
        binQrCodeValue: "aa-batteries",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-1", name: "Batteries" },
        balances: [{ onHandQuantity: 7 }],
        units: [],
      },
    ]));
    vi.mocked(db.asset.findMany).mockResolvedValue(cameraAssets([]));

    const res = await getBatteryOps(makeGetRequest("/api/bulk-skus/batteries"), noParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.totals).toEqual({
      total: 7,
      available: 7,
      checkedOut: 0,
      lost: 0,
      retired: 0,
      lowSkus: 1,
      agingCheckedOut: 0,
    });
    expect(body.data.skus[0]).toEqual(expect.objectContaining({
      id: "sku-aa",
      trackByNumber: false,
      counts: {
        total: 7,
        available: 7,
        checkedOut: 0,
        lost: 0,
        retired: 0,
      },
      units: [],
    }));
  });

  it("BUG: resolves checked-out battery booking context from active unit allocations", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(batterySkus([
      {
        id: "sku-battery",
        name: "Sony Battery",
        category: "Batteries",
        trackByNumber: true,
        minThreshold: 10,
        binQrCodeValue: "sony-battery",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-1", name: "Batteries" },
        balances: [],
        units: [
          {
            id: "unit-2",
            unitNumber: 2,
            status: BulkUnitStatus.CHECKED_OUT,
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [],
          },
        ],
      },
    ]));
    vi.mocked(db.asset.findMany).mockResolvedValue(cameraAssets([]));
    vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue(unitAllocations([
      {
        bulkSkuUnitId: "unit-2",
        checkedOutAt: new Date("2026-06-20T12:00:00.000Z"),
        createdAt: new Date("2026-06-20T12:00:00.000Z"),
        bookingBulkItem: {
          booking: {
            id: "booking-2",
            title: "Football media day",
            refNumber: "CO-2026",
            endsAt: new Date("2026-06-24T18:00:00.000Z"),
            requester: { name: "Alex Student" },
          },
        },
      },
    ]));

    const res = await getBatteryOps(makeGetRequest("/api/bulk-skus/batteries"), noParams);
    const body = await res.json();

    expect(db.bookingBulkUnitAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        checkedOutAt: { not: null },
        checkedInAt: null,
        bookingBulkItem: {
          booking: {
            kind: "CHECKOUT",
            status: "OPEN",
          },
        },
      }),
    }));
    expect(body.data.skus[0].units[0]).toEqual(expect.objectContaining({
      unitNumber: 2,
      checkedOutAt: "2026-06-20T12:00:00.000Z",
      booking: {
        id: "booking-2",
        title: "Football media day",
        refNumber: "CO-2026",
        endsAt: "2026-06-24T18:00:00.000Z",
        requesterName: "Alex Student",
      },
    }));
  });

  it("does not infer checked-out custody from open bulk-item quantity without active unit allocations", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(batterySkus([
      {
        id: "sku-battery",
        name: "Sony Battery",
        category: "Batteries",
        trackByNumber: true,
        minThreshold: 10,
        binQrCodeValue: "sony-battery",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-1", name: "Batteries" },
        balances: [],
        units: [
          {
            id: "unit-2",
            unitNumber: 2,
            status: BulkUnitStatus.CHECKED_OUT,
            updatedAt: new Date("2026-06-24T00:50:02.436Z"),
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [],
          },
          {
            id: "unit-29",
            unitNumber: 29,
            status: BulkUnitStatus.CHECKED_OUT,
            updatedAt: new Date("2026-06-15T20:14:47.626Z"),
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [],
          },
        ],
      },
    ]));
    vi.mocked(db.asset.findMany).mockResolvedValue(cameraAssets([]));
    const res = await getBatteryOps(makeGetRequest("/api/bulk-skus/batteries"), noParams);
    const body = await res.json();
    const units = body.data.skus[0].units;

    expect(units[0]).toEqual(expect.objectContaining({
      unitNumber: 2,
      status: BulkUnitStatus.AVAILABLE,
      checkedOutAt: null,
      booking: null,
    }));
    expect(units[1]).toEqual(expect.objectContaining({
      unitNumber: 29,
      status: BulkUnitStatus.AVAILABLE,
      checkedOutAt: null,
      booking: null,
    }));
    expect(body.data.skus[0].counts).toEqual({
      total: 2,
      available: 2,
      checkedOut: 0,
      lost: 0,
      retired: 0,
    });
    expect(body.data.integrity).toEqual({
      staleCheckedOutCount: 2,
      staleCheckedOutUnits: [
        {
          id: "unit-2",
          skuId: "sku-battery",
          skuName: "Sony Battery",
          locationName: "Camp Randall",
          unitNumber: 2,
        },
        {
          id: "unit-29",
          skuId: "sku-battery",
          skuName: "Sony Battery",
          locationName: "Camp Randall",
          unitNumber: 29,
        },
      ],
    });
    expect(db.bookingBulkItem.findMany).not.toHaveBeenCalled();
  });

  it("BUG: treats stale checked-out units without active checkout context as available", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(batterySkus([
      {
        id: "sku-battery",
        name: "Sony Battery",
        category: "Batteries",
        trackByNumber: true,
        minThreshold: 10,
        binQrCodeValue: "sony-battery",
        location: { id: "loc-1", name: "Camp Randall" },
        categoryRel: { id: "cat-1", name: "Batteries" },
        balances: [],
        units: [
          {
            id: "unit-29",
            unitNumber: 29,
            status: BulkUnitStatus.CHECKED_OUT,
            updatedAt: new Date("2026-06-15T20:14:47.626Z"),
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [],
          },
          {
            id: "unit-31",
            unitNumber: 31,
            status: BulkUnitStatus.CHECKED_OUT,
            updatedAt: new Date("2026-06-15T20:14:47.626Z"),
            notes: null,
            labelPrintedAt: null,
            labelPrintedById: null,
            labelPrintBatchId: null,
            allocations: [],
          },
        ],
      },
    ]));
    vi.mocked(db.asset.findMany).mockResolvedValue(cameraAssets([]));

    const res = await getBatteryOps(makeGetRequest("/api/bulk-skus/batteries"), noParams);
    const body = await res.json();

    expect(body.data.skus[0].units).toEqual([
      expect.objectContaining({ unitNumber: 29, status: BulkUnitStatus.AVAILABLE, booking: null }),
      expect.objectContaining({ unitNumber: 31, status: BulkUnitStatus.AVAILABLE, booking: null }),
    ]);
    expect(body.data.skus[0].counts).toEqual({
      total: 2,
      available: 2,
      checkedOut: 0,
      lost: 0,
      retired: 0,
    });
    expect(body.data.integrity).toEqual({
      staleCheckedOutCount: 2,
      staleCheckedOutUnits: [
        {
          id: "unit-29",
          skuId: "sku-battery",
          skuName: "Sony Battery",
          locationName: "Camp Randall",
          unitNumber: 29,
        },
        {
          id: "unit-31",
          skuId: "sku-battery",
          skuName: "Sony Battery",
          locationName: "Camp Randall",
          unitNumber: 31,
        },
      ],
    });
  });
});
