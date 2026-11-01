import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(),
    asset: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    location: { findMany: vi.fn() },
    department: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
  countByStatus: vi.fn(),
  deriveStatuses: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/status", () => ({
  countAssetsByEffectiveStatus: mocks.countByStatus,
  deriveAssetStatusesFromLoaded: mocks.deriveStatuses,
}));

import {
  getUtilizationReport,
  getUtilizationReportExport,
  parseUtilizationReportPeriod,
} from "@/lib/services/utilization-report";

/** The four custody queries run together; answer them in the order the service issues them. */
function answerCustodyQueries(answers: {
  totals?: unknown[]; topUsed?: unknown[]; idleTotals?: unknown[]; idleRows?: unknown[];
} = {}) {
  mocks.db.$queryRaw
    .mockResolvedValueOnce(answers.totals ?? [])
    .mockResolvedValueOnce(answers.topUsed ?? [])
    .mockResolvedValueOnce(answers.idleTotals ?? [])
    .mockResolvedValueOnce(answers.idleRows ?? []);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.countByStatus.mockResolvedValue({ AVAILABLE: 8, CHECKED_OUT: 2, PENDING_PICKUP: 0, RESERVED: 0, MAINTENANCE: 0, RETIRED: 1 });
  mocks.db.asset.count.mockResolvedValueOnce(11).mockResolvedValueOnce(10);
  mocks.db.asset.groupBy
    .mockResolvedValueOnce([{ locationId: "loc-1", _count: 11 }])
    .mockResolvedValueOnce([{ type: "CAMERA", _count: 6 }, { type: "LENS", _count: 5 }])
    .mockResolvedValueOnce([{ departmentId: "dep-1", _count: 7 }, { departmentId: null, _count: 4 }])
    .mockResolvedValueOnce([{ categoryId: "cat-1", _count: 9 }, { categoryId: null, _count: 2 }]);
  mocks.db.location.findMany.mockResolvedValue([{ id: "loc-1", name: "Camp Randall" }]);
  mocks.db.department.findMany.mockResolvedValue([]);
  mocks.db.category.findMany.mockResolvedValue([{ id: "cat-1", name: "Cameras" }]);
});

describe("parseUtilizationReportPeriod", () => {
  it("accepts only the offered windows and falls back to 90 days", () => {
    expect(parseUtilizationReportPeriod("30")).toBe(30);
    expect(parseUtilizationReportPeriod("365")).toBe(365);
    expect(parseUtilizationReportPeriod("45")).toBe(90);
    expect(parseUtilizationReportPeriod(null)).toBe(90);
    expect(parseUtilizationReportPeriod("abc")).toBe(90);
  });
});

describe("getUtilizationReport", () => {
  it("combines inventory breakdowns with custody-based utilization for the window", async () => {
    answerCustodyQueries({
      totals: [{ custody_days: 45, assets_used: 3, checkout_count: 7 }],
      topUsed: [{ asset_id: "a1", asset_tag: "ROAM2", name: "Sony FX3", checkouts: 4, custody_days: 40 }, { asset_id: "a2", asset_tag: "SLOW1", name: null, checkouts: 1, custody_days: "5" }],
      idleTotals: [{ idle_count: 7, idle_priced_count: 2, never_count: 4, idle_value: "12500.50" }],
      idleRows: [{ asset_id: "a3", asset_tag: "OLD1", name: null, category: null, purchase_price: "999.99", last_checked_out_at: new Date("2026-01-05T12:00:00Z") },
        { asset_id: "a4", asset_tag: "OLD2", name: "Tripod", category: "Support", purchase_price: null, last_checked_out_at: null }],
    });

    const report = await getUtilizationReport(30);

    expect(report).toMatchObject({ days: 30, totalAssets: 11, activeAssets: 10, partialFailures: [] });
    expect(report.statusCounts.CHECKED_OUT).toBe(2);
    expect(report.byLocation).toEqual([{ location: "Camp Randall", locationId: "loc-1", count: 11 }]);
    expect(report.byType).toEqual([{ type: "CAMERA", count: 6 }, { type: "LENS", count: 5 }]);
    // Unnamed departments and categories are dropped; unknown ids keep their count.
    expect(report.byDepartment).toEqual([{ department: "Unknown", departmentId: "dep-1", count: 7 }]);
    expect(report.byCategory).toEqual([{ category: "Cameras", categoryId: "cat-1", count: 9 }]);

    expect(report.custody.assetsUsed).toBe(3);
    expect(report.custody.checkoutCount).toBe(7);
    expect(report.custody.custodyDays).toBe(45);
    // 45 custody-days out of 10 active assets × 30 days.
    expect(report.custody.utilizationRate).toBeCloseTo(0.15);
    expect(report.custody.topUsed).toEqual([
      { assetId: "a1", assetTag: "ROAM2", name: "Sony FX3", checkouts: 4, custodyDays: 40, utilizationRate: 40 / 30 > 1 ? 1 : 40 / 30 },
      { assetId: "a2", assetTag: "SLOW1", name: "", checkouts: 1, custodyDays: 5, utilizationRate: 5 / 30 },
    ]);
    expect(report.custody.topUsed[0]!.utilizationRate).toBe(1);
    expect(report.custody).toMatchObject({ idleCount: 7, idlePricedCount: 2, neverCheckedOutCount: 4, idleValue: 12500.5 });
    expect(report.custody.idleAssets).toEqual([
      { assetId: "a3", assetTag: "OLD1", name: "", category: "", purchasePrice: 999.99, lastCheckedOutAt: "2026-01-05T12:00:00.000Z" },
      { assetId: "a4", assetTag: "OLD2", name: "Tripod", category: "Support", purchasePrice: null, lastCheckedOutAt: null },
    ]);
    expect(mocks.db.department.findMany).toHaveBeenCalledWith({ where: { id: { in: ["dep-1"] } }, select: { id: true, name: true } });
  });

  it("reports empty custody with a zero rate when nothing was checked out", async () => {
    answerCustodyQueries();

    const report = await getUtilizationReport(90);

    expect(report.custody).toMatchObject({ assetsUsed: 0, checkoutCount: 0, custodyDays: 0, utilizationRate: 0, topUsed: [], idleAssets: [], idleCount: 0, idleValue: 0 });
  });

  it("keeps serving the parts that worked and names each failed query", async () => {
    mocks.db.$queryRaw
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce([]);
    mocks.db.asset.groupBy.mockReset()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.db.asset.count.mockReset().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(0);

    const report = await getUtilizationReport(30);

    expect(report.partialFailures).toEqual(["asset total", "location breakdown", "custody totals", "idle gear totals"]);
    expect(report.totalAssets).toBe(0);
    expect(report.byLocation).toEqual([]);
    expect(report.byType).toEqual([]);
    expect(report.custody.utilizationRate).toBe(0);
    expect(mocks.db.location.findMany).not.toHaveBeenCalled();
  });
});

describe("getUtilizationReportExport", () => {
  const asset = (id: string, tag: string) => ({
    id, assetTag: tag, name: null, type: "CAMERA", brand: "Sony", model: "FX3", status: "AVAILABLE",
    availableForReservation: true, availableForCheckout: true, availableForCustody: false,
    updatedAt: new Date("2026-10-30T15:00:00Z"), location: { name: "Camp Randall" }, department: null, category: { name: "Cameras" },
  });

  beforeEach(() => {
    mocks.db.asset.count.mockReset().mockResolvedValue(2);
    mocks.db.asset.findMany.mockResolvedValue([asset("a1", "ROAM2"), asset("a2", "SLOW1")]);
    mocks.deriveStatuses.mockResolvedValue(new Map([["a1", "CHECKED_OUT"]]));
  });

  it("writes one flat row per asset with its effective status and the window's custody stats", async () => {
    mocks.db.$queryRaw.mockResolvedValue([{ asset_id: "a1", checkouts: 3, custody_days: 12.3456, last_checked_out_at: new Date("2026-10-20T10:00:00Z") }]);

    const result = await getUtilizationReportExport(30);

    expect(result).toMatchObject({ days: 30, total: 2, truncated: false, limit: 5000 });
    expect(result.data[0]).toEqual({
      assetTag: "ROAM2", name: "", type: "CAMERA", brand: "Sony", model: "FX3", computedStatus: "CHECKED_OUT", storedStatus: "AVAILABLE",
      location: "Camp Randall", department: "", category: "Cameras",
      availableForReservation: true, availableForCheckout: true, availableForCustody: false,
      periodCheckouts: 3, periodCustodyDays: "12.35", periodUtilizationRate: "41.2%", lastCheckedOutAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-30T15:00:00.000Z",
    });
    expect(result.data[1]).toMatchObject({ assetTag: "SLOW1", computedStatus: "AVAILABLE", periodCheckouts: 0, periodCustodyDays: "0.00", periodUtilizationRate: "0.0%", lastCheckedOutAt: "" });
    expect(mocks.db.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { assetTag: "asc" }, take: 5000 }));
  });

  it("caps utilization at 100%, flags truncated exports, and survives a failed custody query", async () => {
    mocks.db.$queryRaw.mockResolvedValue([{ asset_id: "a1", checkouts: 1, custody_days: 400, last_checked_out_at: null }]);
    mocks.db.asset.count.mockResolvedValue(6000);
    let result = await getUtilizationReportExport(30);
    expect(result.truncated).toBe(true);
    expect(result.data[0]!.periodUtilizationRate).toBe("100.0%");

    mocks.db.$queryRaw.mockRejectedValue(new Error("timeout"));
    result = await getUtilizationReportExport();
    expect(result.days).toBe(90);
    expect(result.data.every((row) => row.periodCheckouts === 0)).toBe(true);
  });
});
