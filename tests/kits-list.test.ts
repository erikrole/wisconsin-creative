import { beforeEach, describe, expect, it, vi } from "vitest";

const kit = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { kit } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
import { listKits } from "@/lib/services/kits";

beforeEach(() => {
  vi.resetAllMocks();
  kit.findMany.mockResolvedValue([{ id: "kit-1" }]);
  kit.groupBy.mockResolvedValue([
    { active: false, _count: { _all: 3 } },
    { active: true, _count: { _all: 7 } },
  ]);
  kit.count.mockResolvedValue(2);
});

describe("kit list aggregates", () => {
  it.each([false, true])("preserves filter-aware totals with includeArchived=%s in three queries", async (includeArchived) => {
    const result = await listKits({ search: "camera", locationId: "loc-1", includeArchived, limit: 2, offset: 4, sortBy: "updatedAt", sortOrder: "desc" });
    const baseWhere = {
      OR: [
        { name: { contains: "camera", mode: "insensitive" } },
        { description: { contains: "camera", mode: "insensitive" } },
      ],
      locationId: "loc-1",
    };
    const where = includeArchived ? baseWhere : { ...baseWhere, active: true };
    const total = includeArchived ? 10 : 7;
    expect(result).toEqual({ data: [{ id: "kit-1" }], total, summary: { total, active: 7, archived: 3, empty: 2 } });
    expect(kit.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where, take: 2, skip: 4, orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    }));
    expect(kit.groupBy).toHaveBeenCalledExactlyOnceWith({ by: ["active"], where: baseWhere, _count: { _all: true } });
    expect(kit.count).toHaveBeenCalledExactlyOnceWith({ where: { ...where, members: { none: {} }, bulkMembers: { none: {} } } });
  });

  it("keeps archived-only matches out of the default total", async () => {
    kit.findMany.mockResolvedValue([]);
    kit.groupBy.mockResolvedValue([{ active: false, _count: { _all: 3 } }]);
    kit.count.mockResolvedValue(0);
    expect(await listKits({ limit: 25, offset: 0 })).toEqual({
      data: [], total: 0, summary: { total: 0, active: 0, archived: 3, empty: 0 },
    });
  });

  it("returns zero counts when no kits match", async () => {
    kit.findMany.mockResolvedValue([]);
    kit.groupBy.mockResolvedValue([]);
    kit.count.mockResolvedValue(0);
    expect(await listKits({ includeArchived: true, limit: 25, offset: 0 })).toEqual({
      data: [], total: 0, summary: { total: 0, active: 0, archived: 0, empty: 0 },
    });
  });

  it("rejects a failed aggregate instead of reporting a false zero", async () => {
    kit.groupBy.mockRejectedValue(new Error("database unavailable"));
    await expect(listKits({ limit: 25, offset: 0 })).rejects.toThrow("database unavailable");
  });
});
