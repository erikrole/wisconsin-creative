import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkUnitStatus, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    bookingBulkUnitAllocation: {
      findMany: vi.fn(),
    },
    bulkSku: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/services/status", () => ({
  buildDerivedStatusWhere: vi.fn(() => []),
  enrichAssetsWithStatusFromLoaded: vi.fn(async (assets: Array<{ computedStatus?: string | null }>) =>
    assets.map((asset) => ({ ...asset, computedStatus: asset.computedStatus ?? "AVAILABLE" })),
  ),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { GET as exportAssets } from "@/app/api/assets/export/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function bulkSkuFindManyResult(rows: Array<Record<string, unknown>>) {
  return rows as unknown as Awaited<ReturnType<typeof db.bulkSku.findMany>>;
}

function assetFindManyResult(rows: Array<Record<string, unknown>>) {
  return rows as unknown as Awaited<ReturnType<typeof db.asset.findMany>>;
}

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(db.asset.findMany).mockResolvedValue([]);
  vi.mocked(db.asset.count).mockResolvedValue(0);
  vi.mocked(db.bulkSku.findMany).mockResolvedValue(bulkSkuFindManyResult([]));
  vi.mocked(db.bulkSku.count).mockResolvedValue(0);
  vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue([]);
});

describe("equipment CSV export route", () => {
  it("rate limits asset export and uses formula-safe CSV fields", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue(assetFindManyResult([
      {
        assetTag: "=CAM-1",
        name: "+Camera",
        brand: "Sony",
        model: "FX3",
        serialNumber: "-SERIAL",
        computedStatus: "AVAILABLE",
        category: { name: "Camera" },
        department: { name: "Photo" },
        location: { name: "Main" },
        purchaseDate: null,
        purchasePrice: null,
      },
    ]));
    vi.mocked(db.asset.count).mockResolvedValue(1);

    const res = await exportAssets(get("/api/assets/export"), { params: Promise.resolve({}) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("asset:export:staff-1", { max: 10, windowMs: 60_000 });
    expect(body).toContain("'=CAM-1");
    expect(body).toContain("'+Camera");
    expect(body).toContain("'-SERIAL");
  });

  it("disables caching for the items CSV", async () => {
    const response = await exportAssets(get("/api/assets/export"), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("exports item-family rows for the selected Items list kind", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(bulkSkuFindManyResult([
      {
        id: "sku-quantity-1",
        name: "Impact MC-FULL Milk Crate (Full Size)",
        category: "Recording Equipment",
        categoryRel: { name: "Lighting" },
        department: { name: "Video" },
        location: { name: "Camp Randall" },
        balances: [{ onHandQuantity: 4 }],
        units: [],
        trackByNumber: false,
        purchasePrice: null,
      },
    ]));
    vi.mocked(db.bulkSku.count).mockResolvedValue(1);

    const res = await exportAssets(get("/api/assets/export?item_type=quantity-tracked"), { params: Promise.resolve({}) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(db.asset.findMany).not.toHaveBeenCalled();
    expect(body).toContain("Impact MC-FULL Milk Crate (Full Size)");
    expect(body).toContain("Quantity-tracked item family");
    expect(body).toContain("4/4 available");
    expect(body).toContain("Lighting");
    expect(body).toContain("Video");
  });

  it("exports unit-tracked item-family availability from effective unit state", async () => {
    vi.mocked(db.bulkSku.findMany).mockResolvedValue(bulkSkuFindManyResult([
      {
        id: "sku-units-1",
        name: "Sony NP-FZ100 Battery",
        category: "Batteries",
        categoryRel: { name: "Batteries" },
        department: { name: "Video" },
        location: { name: "Camp Randall" },
        balances: [{ onHandQuantity: 99 }],
        units: [
          { id: "unit-orphan", status: BulkUnitStatus.CHECKED_OUT },
          { id: "unit-active", status: BulkUnitStatus.AVAILABLE },
          { id: "unit-lost", status: BulkUnitStatus.LOST },
        ],
        trackByNumber: true,
        purchasePrice: null,
      },
    ]));
    vi.mocked(db.bulkSku.count).mockResolvedValue(1);
    vi.mocked(db.bookingBulkUnitAllocation.findMany).mockResolvedValue([
      { bulkSkuUnitId: "unit-active" },
    ] as Awaited<ReturnType<typeof db.bookingBulkUnitAllocation.findMany>>);

    const res = await exportAssets(get("/api/assets/export?item_type=unit-tracked"), { params: Promise.resolve({}) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Sony NP-FZ100 Battery");
    expect(body).toContain("Unit-tracked item family");
    expect(body).toContain("1/3 available");
  });
});
