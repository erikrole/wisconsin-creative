import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetStatus, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    favoriteItem: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/status", () => ({
  buildDerivedStatusWhere: vi.fn(() => []),
  enrichAssetsWithStatusFromLoaded: vi.fn(async (assets: Array<{ computedStatus?: string | null }>) =>
    assets.map((asset) => ({ ...asset, computedStatus: asset.computedStatus ?? "AVAILABLE" })),
  ),
}));

vi.mock("@/lib/equipment-section-filters", () => ({
  ALL_SECTION_KEYS: ["camera", "audio"],
  sectionWhere: vi.fn((key: string) => ({ type: key })),
}));

vi.mock("@/lib/equipment-sections", () => ({}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildDerivedStatusWhere } from "@/lib/services/status";
import { GET as pickerSearch } from "@/app/api/assets/picker-search/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

type DerivedStatusWhere = { status: AssetStatus; __derived: boolean };

function assetFindManyResult(rows: Array<Record<string, unknown>>) {
  return rows as unknown as Awaited<ReturnType<typeof db.asset.findMany>>;
}

function derivedStatusWhereResult(rows: DerivedStatusWhere[]) {
  return rows as unknown as ReturnType<typeof buildDerivedStatusWhere>;
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
  vi.mocked(db.favoriteItem.findMany).mockResolvedValue([]);
});

describe("equipment picker search route", () => {
  it("caps equipment picker page size at the route boundary", async () => {
    await pickerSearch(get("/api/assets/picker-search?limit=200"), { params: Promise.resolve({}) });

    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );
  });

  it("sorts equipment picker rows by asset-tag family instead of hidden popularity", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue(assetFindManyResult([
      { id: "asset-fx3-1", assetTag: "FX3 1", status: AssetStatus.AVAILABLE, category: null },
      { id: "asset-a1-2", assetTag: "a1 II 1", status: AssetStatus.AVAILABLE, category: null },
      { id: "asset-fb-a7", assetTag: "FB A7 IV 1", status: AssetStatus.AVAILABLE, category: null },
      { id: "asset-fb-fx3", assetTag: "FB FX3 2", status: AssetStatus.AVAILABLE, category: null },
      { id: "asset-fb-a1", assetTag: "FB a1 1", status: AssetStatus.AVAILABLE, category: null },
    ]));
    vi.mocked(db.asset.count).mockResolvedValue(5);

    const res = await pickerSearch(get("/api/assets/picker-search?section=cameras"), { params: Promise.resolve({}) });
    const body = await res.json() as { data: { assets: Array<{ assetTag: string }> } };

    expect(res.status).toBe(200);
    expect(body.data.assets.map((asset) => asset.assetTag)).toEqual([
      "FB a1 1",
      "a1 II 1",
      "FB A7 IV 1",
      "FX3 1",
      "FB FX3 2",
    ]);
  });

  it("filters equipment picker available-only by derived availability, not stored status", async () => {
    const derivedAvailable: DerivedStatusWhere[] = [{ status: AssetStatus.AVAILABLE, __derived: true }];
    vi.mocked(buildDerivedStatusWhere).mockReturnValue(derivedStatusWhereResult(derivedAvailable));

    await pickerSearch(
      get("/api/assets/picker-search?only_available=true"),
      { params: Promise.resolve({}) },
    );

    expect(buildDerivedStatusWhere).toHaveBeenCalledWith(["AVAILABLE"]);

    // Rows query must use the derived OR clause, never a bare stored status filter.
    const findManyWhere = vi.mocked(db.asset.findMany).mock.calls.at(0)?.[0]?.where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(findManyWhere.AND).toContainEqual({ OR: derivedAvailable });
    expect(findManyWhere.AND).not.toContainEqual({ status: "AVAILABLE" });

    // Section counts must use the same derived OR clause for honest tab badges.
    const countWheres = vi
      .mocked(db.asset.count)
      .mock.calls.map((call) => call[0]?.where) as Array<{ AND?: Array<Record<string, unknown>> }>;
    const sectionCountWhere = countWheres.find((w) => Array.isArray(w?.AND));
    expect(sectionCountWhere?.AND).toContainEqual({ OR: derivedAvailable });
    expect(sectionCountWhere?.AND).not.toContainEqual({ status: "AVAILABLE" });
  });

  it("keeps ids hydration and qr lookup exempt from available-only filtering", async () => {
    const derivedAvailable: DerivedStatusWhere[] = [{ status: AssetStatus.AVAILABLE, __derived: true }];
    vi.mocked(buildDerivedStatusWhere).mockReturnValue(derivedStatusWhereResult(derivedAvailable));

    await pickerSearch(
      get("/api/assets/picker-search?only_available=true&ids=asset-stale"),
      { params: Promise.resolve({}) },
    );
    const idsWhere = vi.mocked(db.asset.findMany).mock.calls.at(0)?.[0]?.where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(idsWhere.AND).not.toContainEqual({ OR: derivedAvailable });
    expect(idsWhere.AND).toContainEqual({ id: { in: ["asset-stale"] } });

    vi.mocked(db.asset.findMany).mockClear();

    await pickerSearch(
      get("/api/assets/picker-search?only_available=true&qr=CAM-1"),
      { params: Promise.resolve({}) },
    );
    const qrWhere = vi.mocked(db.asset.findMany).mock.calls.at(0)?.[0]?.where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(qrWhere.AND).not.toContainEqual({ OR: derivedAvailable });
  });
});
