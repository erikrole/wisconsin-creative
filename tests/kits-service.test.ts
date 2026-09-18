import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    kit: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    location: { findUnique: vi.fn(), findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    kitMembership: { findMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    kitBulkMembership: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    bulkSku: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    db: {
      location: { findUnique: vi.fn(), findMany: vi.fn() },
      kit: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
      booking: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: vi.fn(),
}));

import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import {
  addKitBulkMember,
  addKitMembers,
  cloneKit,
  createKit,
  loadKitEquipmentPlan,
  suggestFootballGamedayKit,
  updateKit,
} from "@/lib/services/kits";

type MockFn = ReturnType<typeof vi.fn>;
const mockDb = db as unknown as {
  location: Record<"findUnique" | "findMany", MockFn>;
  kit: Record<"findFirst", MockFn>;
  booking: Record<"findFirst", MockFn>;
  _mockTx: {
    kit: Record<"findUnique" | "findUniqueOrThrow" | "findMany" | "findFirst" | "create" | "update", MockFn>;
    location: Record<"findUnique" | "findMany", MockFn>;
    asset: Record<"findMany", MockFn>;
    kitMembership: Record<"findMany" | "createMany", MockFn>;
    kitBulkMembership: Record<"upsert", MockFn>;
    bulkSku: Record<"findUnique", MockFn>;
  };
};
const mockTx = mockDb._mockTx;

const actor = { id: "user-1", role: Role.ADMIN };

beforeEach(() => {
  transactionCalls.length = 0;
  vi.clearAllMocks();
  mockTx.kit.findUnique.mockResolvedValue({
    id: "kit-1",
    name: "Slow 1",
    locationId: "loc-1",
    sportCode: "FB",
    location: { name: "Camp Randall" },
  });
  mockTx.kit.findUniqueOrThrow.mockResolvedValue({ id: "kit-1", members: [] });
  mockTx.kit.findFirst.mockResolvedValue(null);
  mockTx.kit.findMany.mockResolvedValue([]);
  mockTx.location.findMany.mockResolvedValue([{ id: "loc-1" }]);
  mockTx.kit.create.mockResolvedValue({
    id: "kit-copy",
    name: "Slow 1 copy",
    locationId: "loc-1",
    members: [],
    bulkMembers: [],
  });
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined as never);
});

describe("kit membership writes", () => {
  it("rejects items from another location by location name", async () => {
    mockTx.asset.findMany.mockResolvedValue([
      { id: "cam-1", assetTag: "FX6-2", locationId: "loc-kohl", location: { name: "Kohl Center" } },
    ]);

    await expect(addKitMembers("kit-1", ["cam-1"], actor.id, actor.role)).rejects.toMatchObject({
      status: 400,
      message: "These items belong to a different location than Camp Randall: FX6-2",
    });
    expect(mockTx.kitMembership.createMany).not.toHaveBeenCalled();
    expectSerializableIsolation(transactionCalls);
  });

  it("adds only new members and reports already-in-kit as skipped", async () => {
    mockTx.asset.findMany.mockResolvedValue([
      { id: "cam-1", assetTag: "FX6-1", locationId: "loc-1", location: { name: "Camp Randall" } },
      { id: "cam-2", assetTag: "FX6-2", locationId: "loc-1", location: { name: "Camp Randall" } },
    ]);
    mockTx.kitMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ assetId: "cam-1" }]);
    mockTx.kitMembership.createMany.mockResolvedValue({ count: 1 });

    const result = await addKitMembers("kit-1", ["cam-1", "cam-2"], actor.id, actor.role);

    expect(result.addedAssetIds).toEqual(["cam-2"]);
    expect(mockTx.kitMembership.createMany).toHaveBeenCalledWith({
      data: [{ kitId: "kit-1", assetId: "cam-2" }],
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      action: "add_members",
      after: expect.objectContaining({ assetIds: ["cam-2"], skippedAlreadyMembers: 1 }),
    }));
  });

  it("rejects a camera already in another active kit for the same sport", async () => {
    mockTx.asset.findMany.mockResolvedValue([
      { id: "cam-1", assetTag: "FX6-1", locationId: "loc-1", location: { name: "Camp Randall Stadium" } },
    ]);
    mockTx.kitMembership.findMany.mockResolvedValueOnce([
      { asset: { assetTag: "FX6-1" }, kit: { name: "Slow 1" } },
    ]);

    await expect(addKitMembers("kit-1", ["cam-1"], actor.id, actor.role)).rejects.toMatchObject({
      status: 409,
      message: "FX6-1 is already in Slow 1",
    });
    expect(mockTx.kitMembership.createMany).not.toHaveBeenCalled();
  });

  it("allows the same camera on a different-sport kit", async () => {
    mockTx.kit.findUnique.mockResolvedValue({
      id: "kit-bball",
      name: "High 1",
      locationId: "loc-1",
      sportCode: "MBB",
      location: { name: "Camp Randall" },
    });
    mockTx.asset.findMany.mockResolvedValue([
      { id: "cam-1", assetTag: "FX6-1", locationId: "loc-stadium", location: { name: "Camp Randall Stadium" } },
    ]);
    mockTx.kitMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockTx.kitMembership.createMany.mockResolvedValue({ count: 1 });

    await addKitMembers("kit-bball", ["cam-1"], actor.id, actor.role);

    expect(mockTx.kitMembership.createMany).toHaveBeenCalledWith({
      data: [{ kitId: "kit-bball", assetId: "cam-1" }],
    });
  });

  it("rejects item families from another location", async () => {
    mockTx.bulkSku.findUnique.mockResolvedValue({
      id: "sku-1",
      name: "Football Sony Battery",
      locationId: "loc-kohl",
      active: true,
      location: { name: "Kohl Center" },
    });

    await expect(addKitBulkMember("kit-1", { bulkSkuId: "sku-1", quantity: 4 }, actor.id, actor.role)).rejects.toMatchObject({
      status: 400,
      message: "Football Sony Battery belongs to a different location than Camp Randall",
    });
    expect(mockTx.kitBulkMembership.upsert).not.toHaveBeenCalled();
  });
});

describe("cloneKit", () => {
  it("copies batteries and sport, not cameras", async () => {
    mockTx.kit.findUnique.mockResolvedValue({
      id: "kit-1",
      name: "Slow 1",
      description: "Gameday",
      locationId: "loc-1",
      sportCode: "FB",
      gamedayRole: "SLOW1",
      members: [{ assetId: "cam-1" }],
      bulkMembers: [{ bulkSkuId: "battery-1", quantity: 4 }],
    });
    mockTx.kit.findMany.mockResolvedValue([{ name: "Slow 1 copy" }]);

    await cloneKit("kit-1", actor.id, actor.role);

    expect(mockTx.kit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "Slow 1 copy 2",
        locationId: "loc-1",
        sportCode: "FB",
        bulkMembers: { create: [{ bulkSkuId: "battery-1", quantity: 4 }] },
      }),
    }));
    const created = mockTx.kit.create.mock.calls[0]?.[0] as { data?: { members?: unknown } } | undefined;
    expect(created?.data?.members).toBeUndefined();
    expect(created?.data).not.toHaveProperty("gamedayRole");
    expectSerializableIsolation(transactionCalls);
  });
});

describe("football gameday jobs", () => {
  it("rejects a second Slow 1 kit at the same pickup", async () => {
    vi.mocked(db.location.findUnique).mockResolvedValue({
      id: "loc-1",
      name: "Camp Randall",
    } as never);
    mockTx.location.findMany.mockResolvedValue([{ id: "loc-1" }, { id: "loc-stadium" }]);
    mockTx.kit.findFirst.mockResolvedValue({ name: "Slow 1 FX6" });

    await expect(createKit(
      { name: "Slow 1", locationId: "loc-1", sportCode: "FB", gamedayRole: "SLOW1" },
      actor.id,
      actor.role,
    )).rejects.toMatchObject({
      status: 409,
      message: "Slow 1 already has a kit at this pickup",
    });
    expect(mockTx.kit.create).not.toHaveBeenCalled();
  });

  it("rejects Slow 1 on a basketball kit", async () => {
    vi.mocked(db.location.findUnique).mockResolvedValue({
      id: "loc-1",
      name: "Kohl Center",
    } as never);

    await expect(createKit(
      { name: "Slow 1", locationId: "loc-1", sportCode: "MBB", gamedayRole: "SLOW1" },
      actor.id,
      actor.role,
    )).rejects.toMatchObject({
      status: 400,
      message: "Slow 1, Bench, and Roam kits are football jobs",
    });
  });

  it("clears the football job when the kit leaves football", async () => {
    mockTx.kit.findUnique.mockResolvedValue({
      id: "kit-1",
      name: "Slow 1",
      description: null,
      locationId: "loc-1",
      sportCode: "FB",
      gamedayRole: "SLOW1",
      active: true,
      location: { name: "Camp Randall" },
    });
    mockTx.kitMembership.findMany.mockResolvedValue([]);
    mockTx.kit.update.mockResolvedValue({
      id: "kit-1",
      name: "Slow 1",
      sportCode: "MBB",
      gamedayRole: null,
      active: true,
    });

    await updateKit("kit-1", { sportCode: "MBB" }, actor.id, actor.role);

    expect(mockTx.kit.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportCode: "MBB", gamedayRole: null }),
    }));
  });

  it("suggests this week's Slow 1 kit from last week's job", async () => {
    mockDb.location.findUnique.mockResolvedValue({ name: "Camp Randall" });
    mockDb.location.findMany.mockResolvedValue([{ id: "loc-1" }, { id: "loc-stadium" }]);
    mockDb.booking.findFirst.mockResolvedValue({ kit: { gamedayRole: "SLOW1" } });
    mockDb.kit.findFirst.mockResolvedValue({ id: "kit-slow-now" });

    await expect(suggestFootballGamedayKit({
      requesterUserId: "user-2",
      locationId: "loc-1",
    })).resolves.toBe("kit-slow-now");
    expect(mockDb.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requesterUserId: "user-2",
        kit: { gamedayRole: { not: null } },
      }),
    }));
    expect(mockDb.kit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        gamedayRole: "SLOW1",
        locationId: { in: ["loc-1", "loc-stadium"] },
      }),
    }));
  });

  it("does not suggest an empty or missing football job kit", async () => {
    mockDb.location.findUnique.mockResolvedValue({ name: "Kohl Center" });
    mockDb.booking.findFirst.mockResolvedValue({ kit: { gamedayRole: "ROAM1" } });
    mockDb.kit.findFirst.mockResolvedValue(null);

    await expect(suggestFootballGamedayKit({
      requesterUserId: "user-2",
      locationId: "loc-kohl",
    })).resolves.toBeNull();
  });
});

describe("loadKitEquipmentPlan", () => {
  it("returns serialized and bulk members for an active same-location kit", async () => {
    const tx = {
      kit: {
        findUnique: vi.fn().mockResolvedValue({
          id: "kit-1",
          name: "Slow 1",
          active: true,
          locationId: "loc-1",
          location: { name: "Camp Randall" },
          members: [{ assetId: "cam-1" }],
          bulkMembers: [{ bulkSkuId: "battery-1", quantity: 4 }],
        }),
      },
      location: {
        findUnique: vi.fn().mockResolvedValue({ name: "Camp Randall Stadium" }),
      },
    };

    await expect(loadKitEquipmentPlan(tx as never, "kit-1", "loc-stadium")).resolves.toEqual({
      kitId: "kit-1",
      name: "Slow 1",
      serializedAssetIds: ["cam-1"],
      bulkItems: [{ bulkSkuId: "battery-1", quantity: 4 }],
    });
  });
});
