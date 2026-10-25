import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({ db: { assetAllocation: { findMany: vi.fn() } } }));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import {
  buildDerivedStatusWhere,
  deriveAssetStatusesFromLoaded,
  enrichAssetsWithStatusFromLoaded,
} from "@/lib/services/status";

const past = new Date(Date.now() - 3_600_000);
const future = new Date(Date.now() + 86_400_000);

function allocation(assetId: string, kind: string, status: string, startsAt = past) {
  return { assetId, startsAt, endsAt: future, booking: { kind, status } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.assetAllocation.findMany.mockResolvedValue([]);
});

describe("deriveAssetStatusesFromLoaded", () => {
  it("settles maintenance and retired items without a query", async () => {
    const result = await deriveAssetStatusesFromLoaded([
      { id: "fix", status: AssetStatus.MAINTENANCE },
      { id: "old", status: AssetStatus.RETIRED },
    ]);

    expect(Object.fromEntries(result)).toEqual({ fix: "MAINTENANCE", old: "RETIRED" });
    expect(mocks.db.assetAllocation.findMany).not.toHaveBeenCalled();
  });

  it("ranks an open checkout over a pending pickup over a due reservation", async () => {
    mocks.db.assetAllocation.findMany.mockResolvedValue([
      allocation("out", "RESERVATION", "BOOKED"),
      allocation("out", "CHECKOUT", "OPEN"),
      allocation("pickup", "RESERVATION", "BOOKED"),
      allocation("pickup", "CHECKOUT", "PENDING_PICKUP"),
      allocation("due", "RESERVATION", "BOOKED"),
      allocation("later", "RESERVATION", "BOOKED", future),
    ]);

    const result = await deriveAssetStatusesFromLoaded(
      ["out", "pickup", "due", "later", "free"].map((id) => ({ id, status: AssetStatus.AVAILABLE })),
    );

    expect(Object.fromEntries(result)).toEqual({
      out: "CHECKED_OUT",
      pickup: "PENDING_PICKUP",
      due: "PENDING_PICKUP",
      later: "AVAILABLE",
      free: "AVAILABLE",
    });
    expect(mocks.db.assetAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assetId: { in: ["out", "pickup", "due", "later", "free"] }, active: true }),
    }));
  });

  it("reads through a transaction when given one", async () => {
    const tx = { assetAllocation: { findMany: vi.fn().mockResolvedValue([]) } };

    await deriveAssetStatusesFromLoaded([{ id: "a", status: AssetStatus.AVAILABLE }], tx as never);

    expect(tx.assetAllocation.findMany).toHaveBeenCalled();
    expect(mocks.db.assetAllocation.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing for no items", async () => {
    expect((await deriveAssetStatusesFromLoaded([])).size).toBe(0);
    expect(await enrichAssetsWithStatusFromLoaded([])).toEqual([]);
  });
});

describe("enrichAssetsWithStatusFromLoaded", () => {
  it("adds the effective status to each loaded item", async () => {
    mocks.db.assetAllocation.findMany.mockResolvedValue([allocation("out", "CHECKOUT", "OPEN")]);

    const enriched = await enrichAssetsWithStatusFromLoaded([
      { id: "out", status: AssetStatus.AVAILABLE, assetTag: "ROAM2" },
      { id: "fix", status: AssetStatus.MAINTENANCE, assetTag: "SLOW1" },
    ]);

    expect(enriched).toEqual([
      { id: "out", status: AssetStatus.AVAILABLE, assetTag: "ROAM2", computedStatus: "CHECKED_OUT" },
      { id: "fix", status: AssetStatus.MAINTENANCE, assetTag: "SLOW1", computedStatus: "MAINTENANCE" },
    ]);
  });
});

describe("buildDerivedStatusWhere", () => {
  it("filters available items with no live checkout and no due reservation", () => {
    const [clause] = buildDerivedStatusWhere(["AVAILABLE"]) as Array<{ status: string; AND: Array<{ allocations: { none: Record<string, unknown> } }> }>;

    expect(clause?.status).toBe("AVAILABLE");
    expect(clause?.AND[0]?.allocations.none).toEqual({
      active: true,
      booking: { kind: "CHECKOUT", status: { in: ["OPEN", "PENDING_PICKUP"] } },
    });
    expect(clause?.AND[1]?.allocations.none).toEqual(expect.objectContaining({
      active: true,
      startsAt: { lte: expect.any(Date) },
      booking: { kind: "RESERVATION", status: "BOOKED" },
    }));
  });

  it("finds checked-out items by an open checkout", () => {
    expect(buildDerivedStatusWhere(["CHECKED_OUT"])).toEqual([{
      status: "AVAILABLE",
      allocations: { some: { active: true, booking: { kind: "CHECKOUT", status: "OPEN" } } },
    }]);
  });

  it("treats a due reservation as waiting for pickup", () => {
    const [clause] = buildDerivedStatusWhere(["PENDING_PICKUP"]) as Array<{ OR: Array<{ allocations: { some: Record<string, unknown> } }> }>;

    expect(clause?.OR.map((option) => option.allocations.some.booking)).toEqual([
      { kind: "CHECKOUT", status: "PENDING_PICKUP" },
      { kind: "RESERVATION", status: "BOOKED" },
    ]);
  });

  it("keeps the old reserved filter empty and passes stored statuses through", () => {
    expect(buildDerivedStatusWhere(["RESERVED", "MAINTENANCE", "RETIRED", "UNKNOWN"])).toEqual([
      { id: { in: [] } },
      { status: "MAINTENANCE" },
      { status: "RETIRED" },
    ]);
  });
});
