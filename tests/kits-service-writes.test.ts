import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    kit: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    location: { findUnique: vi.fn(), findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    kitMembership: { findMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    kitBulkMembership: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    bulkSku: { findUnique: vi.fn() },
  };
  return {
    tx,
    db: {
      location: { findUnique: vi.fn(), findMany: vi.fn() },
      kit: { findUnique: vi.fn(), findFirst: vi.fn() },
      booking: { findFirst: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    audit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));

import {
  addKitBulkMember,
  addKitMembers,
  cloneKit,
  createKit,
  deleteKit,
  getKitDetail,
  loadKitEquipmentPlan,
  removeKitBulkMember,
  removeKitMember,
  suggestFootballGamedayKit,
  updateKit,
} from "@/lib/services/kits";

const { tx, db } = mocks;
const camp = { name: "Camp Randall" };

function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.location.findUnique.mockResolvedValue({ id: "loc-1", name: "Kohl Center" });
  tx.kit.findFirst.mockResolvedValue(null);
  tx.kit.findMany.mockResolvedValue([]);
  tx.kitMembership.findMany.mockResolvedValue([]);
  tx.kit.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "kit-new", ...data }));
  tx.kit.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "kit-1", ...data }));
});

describe("createKit", () => {
  it("refuses an unknown location and a football job on another sport", async () => {
    db.location.findUnique.mockResolvedValueOnce(null);
    await expect(createKit({ name: "Bag", locationId: "nope" } as never, "u1", Role.STAFF)).rejects.toMatchObject({ status: 400, message: "Location not found" });

    await expect(createKit({ name: "Bag", locationId: "loc-1", sportCode: "MBB", gamedayRole: "SLOW1" } as never, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 400, message: "Slow 1, Bench, and Roam kits are football jobs" });
  });

  it("trims the name, blanks an empty description and records the create", async () => {
    const kit = await createKit({ name: "  Road pack ", description: "  ", locationId: "loc-1", sportCode: "MBB" } as never, "u1", Role.STAFF);

    expect(kit).toEqual(expect.objectContaining({ name: "Road pack", description: null, sportCode: "MBB", gamedayRole: null }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "create", entityId: "kit-new" }));
  });

  it("refuses a second kit for the same football job at a pickup", async () => {
    tx.kit.findFirst.mockResolvedValue({ name: "Old Slow 1" });

    await expect(createKit({ name: "Slow 1", locationId: "loc-1", gamedayRole: "SLOW1" } as never, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already has a kit at this pickup$/) });
    expect(tx.kit.create).not.toHaveBeenCalled();
  });

  it("looks across shared pickup rooms for a job collision", async () => {
    db.location.findUnique.mockResolvedValue({ id: "loc-1", name: "Camp Randall" });
    tx.location.findMany.mockResolvedValue([{ id: "loc-1" }, { id: "loc-2" }]);

    await createKit({ name: "Slow 1", locationId: "loc-1", gamedayRole: "SLOW1" } as never, "u1", Role.STAFF);

    expect(tx.kit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ gamedayRole: "SLOW1", locationId: { in: ["loc-1", "loc-2"] } }),
    }));
  });

  it("explains which unique rule a race tripped", async () => {
    tx.kit.create.mockRejectedValueOnce(uniqueError(["location_id", "gameday_role"]));
    await expect(createKit({ name: "Slow 1", locationId: "loc-1", gamedayRole: "SLOW1" } as never, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 409, message: "That football job already has a kit at this pickup" });

    tx.kit.create.mockRejectedValueOnce(uniqueError(["location_id", "name"]));
    await expect(createKit({ name: "Bag", locationId: "loc-1" } as never, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 409, message: "A kit with this name already exists at this location" });
  });
});

describe("updateKit", () => {
  const existing = { id: "kit-1", name: "Slow 1", description: null, active: true, locationId: "loc-1", sportCode: "FB", gamedayRole: "SLOW1", location: camp };

  it("returns 404 for an unknown kit", async () => {
    tx.kit.findUnique.mockResolvedValue(null);

    await expect(updateKit("nope", { name: "x" } as never, "u1", Role.STAFF)).rejects.toMatchObject({ status: 404 });
  });

  it("drops the football job when the kit moves to another sport", async () => {
    tx.kit.findUnique.mockResolvedValue(existing);

    await updateKit("kit-1", { sportCode: "MBB" } as never, "u1", Role.STAFF);

    expect(tx.kit.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sportCode: "MBB", gamedayRole: null } }));
    expect(tx.kit.findFirst).not.toHaveBeenCalled();
  });

  it("refuses to share a body with another kit in the same sport", async () => {
    tx.kit.findUnique.mockResolvedValue({ ...existing, sportCode: "MBB", gamedayRole: null });
    tx.kitMembership.findMany
      .mockResolvedValueOnce([{ assetId: "cam-1" }])
      .mockResolvedValueOnce([{ asset: { assetTag: "ROAM2" }, kit: { name: "Bench bag" } }]);

    await expect(updateKit("kit-1", { name: "Bag" } as never, "u1", Role.STAFF)).rejects.toMatchObject({
      status: 409,
      message: "ROAM2 is already in Bench bag, another kit in this sport; remove it there first",
    });
  });

  it("skips the overlap checks for an archived kit and records before and after", async () => {
    tx.kit.findUnique.mockResolvedValue(existing);

    await updateKit("kit-1", { active: false, description: " Spare " } as never, "u1", Role.STAFF);

    expect(tx.kitMembership.findMany).not.toHaveBeenCalled();
    expect(tx.kit.update).toHaveBeenCalledWith(expect.objectContaining({ data: { active: false, description: "Spare" } }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "update",
      before: expect.objectContaining({ active: true }),
      after: expect.objectContaining({ active: false, description: "Spare" }),
    }));
  });

  it("maps a unique race to a 409", async () => {
    tx.kit.findUnique.mockResolvedValue(existing);
    tx.kit.update.mockRejectedValueOnce(uniqueError(["name"]));

    await expect(updateKit("kit-1", { name: "Taken" } as never, "u1", Role.STAFF)).rejects.toMatchObject({ status: 409 });
  });
});

describe("deleteKit and cloneKit", () => {
  it("records how many members a deleted kit had", async () => {
    tx.kit.findUnique.mockResolvedValue({ id: "kit-1", name: "Bag", _count: { members: 3, bulkMembers: 2 } });

    await deleteKit("kit-1", "u1", Role.STAFF);

    expect(tx.kit.delete).toHaveBeenCalledWith({ where: { id: "kit-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "delete",
      before: { name: "Bag", memberCount: 5, serializedMemberCount: 3, bulkMemberCount: 2 },
    }));
  });

  it("returns 404 when deleting or copying an unknown kit", async () => {
    tx.kit.findUnique.mockResolvedValue(null);

    await expect(deleteKit("nope", "u1", Role.STAFF)).rejects.toMatchObject({ status: 404 });
    await expect(cloneKit("nope", "u1", Role.STAFF)).rejects.toMatchObject({ status: 404 });
  });

  it("numbers copies past the taken names and gives up after 50", async () => {
    tx.kit.findUnique.mockResolvedValue({ id: "kit-1", name: "Bag", description: null, locationId: "loc-1", sportCode: null, bulkMembers: [] });
    tx.kit.findMany.mockResolvedValueOnce([{ name: "Bag copy" }, { name: "Bag copy 2" }]);

    expect(await cloneKit("kit-1", "u1", Role.STAFF)).toEqual(expect.objectContaining({ name: "Bag copy 3" }));

    tx.kit.findMany.mockResolvedValueOnce([{ name: "Bag copy" }, ...Array.from({ length: 49 }, (_, index) => ({ name: `Bag copy ${index + 2}` }))]);
    await expect(cloneKit("kit-1", "u1", Role.STAFF)).rejects.toMatchObject({ status: 409, message: "Could not create a unique copy name at this location" });
  });

  it("maps a unique race on a copy to a 409", async () => {
    tx.kit.findUnique.mockResolvedValue({ id: "kit-1", name: "Bag", description: null, locationId: "loc-1", sportCode: null, bulkMembers: [] });
    tx.kit.create.mockRejectedValueOnce(uniqueError(["name"]));

    await expect(cloneKit("kit-1", "u1", Role.STAFF)).rejects.toMatchObject({ status: 409 });
  });
});

describe("suggestFootballGamedayKit", () => {
  it("suggests nothing for an unknown pickup or a person with no football job history", async () => {
    db.location.findUnique.mockResolvedValueOnce(null);
    expect(await suggestFootballGamedayKit({ requesterUserId: "ada", locationId: "nope" })).toBeNull();

    db.booking.findFirst.mockResolvedValueOnce(null);
    expect(await suggestFootballGamedayKit({ requesterUserId: "ada", locationId: "loc-1" })).toBeNull();
    expect(db.kit.findFirst).not.toHaveBeenCalled();
  });

  it("suggests the current kit for the job the person last took", async () => {
    db.booking.findFirst.mockResolvedValue({ kit: { gamedayRole: "ROAM2" } });
    db.kit.findFirst.mockResolvedValue({ id: "kit-roam2" });

    expect(await suggestFootballGamedayKit({ requesterUserId: "ada", locationId: "loc-1" })).toBe("kit-roam2");
    expect(db.kit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ gamedayRole: "ROAM2", locationId: "loc-1" }) }));

    db.kit.findFirst.mockResolvedValue(null);
    expect(await suggestFootballGamedayKit({ requesterUserId: "ada", locationId: "loc-1" })).toBeNull();
  });
});

describe("kit members", () => {
  it("refuses an empty list, an unknown kit and a missing item", async () => {
    await expect(addKitMembers("kit-1", [], "u1", Role.STAFF)).rejects.toMatchObject({ status: 400, message: "No assets provided" });

    tx.kit.findUnique.mockResolvedValueOnce(null);
    await expect(addKitMembers("nope", ["a"], "u1", Role.STAFF)).rejects.toMatchObject({ status: 404 });

    tx.kit.findUnique.mockResolvedValueOnce({ id: "kit-1", sportCode: null, gamedayRole: null, location: camp });
    tx.asset.findMany.mockResolvedValueOnce([]);
    await expect(addKitMembers("kit-1", ["a", "a"], "u1", Role.STAFF)).rejects.toMatchObject({ status: 400, message: "One or more assets not found" });
  });

  it("refuses items already in the kit unless asked to allow it", async () => {
    tx.kit.findUnique.mockResolvedValue({ id: "kit-1", sportCode: "FB", gamedayRole: null, location: camp });
    tx.asset.findMany.mockResolvedValue([{ id: "a", assetTag: "ROAM2", location: camp }]);
    tx.kitMembership.findMany.mockResolvedValue([{ assetId: "a" }]);
    tx.kit.findUniqueOrThrow.mockResolvedValue({ id: "kit-1" });

    await expect(addKitMembers("kit-1", ["a"], "u1", Role.STAFF)).rejects.toMatchObject({ status: 409, message: "Those items are already in this kit" });
    expect(await addKitMembers("kit-1", ["a"], "u1", Role.STAFF, { allowAlreadyMembers: true })).toEqual({ kit: { id: "kit-1" }, addedAssetIds: [] });
    expect(tx.kitMembership.createMany).not.toHaveBeenCalled();
  });

  it("removes a member only from its own kit", async () => {
    tx.kitMembership.findUnique.mockResolvedValueOnce({ id: "m1", kitId: "other", assetId: "a", asset: { assetTag: "ROAM2" } });
    await expect(removeKitMember("kit-1", "m1", "u1", Role.STAFF)).rejects.toMatchObject({ status: 404, message: "Membership not found" });

    tx.kitMembership.findUnique.mockResolvedValueOnce({ id: "m1", kitId: "kit-1", assetId: "a", asset: { assetTag: "ROAM2" } });
    await removeKitMember("kit-1", "m1", "u1", Role.STAFF);
    expect(tx.kitMembership.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "remove_member", before: { assetId: "a", assetTag: "ROAM2" } }));
  });
});

describe("kit counted items", () => {
  beforeEach(() => {
    tx.kit.findUnique.mockResolvedValue({ id: "kit-1", location: camp });
  });

  it("refuses an unknown kit, an unknown family, an archived family and another location", async () => {
    tx.kit.findUnique.mockResolvedValueOnce(null);
    await expect(addKitBulkMember("nope", { bulkSkuId: "b", quantity: 2 }, "u1", Role.STAFF)).rejects.toMatchObject({ status: 404, message: "Kit not found" });

    tx.bulkSku.findUnique.mockResolvedValueOnce(null);
    await expect(addKitBulkMember("kit-1", { bulkSkuId: "b", quantity: 2 }, "u1", Role.STAFF)).rejects.toMatchObject({ status: 404, message: "Item family not found" });

    tx.bulkSku.findUnique.mockResolvedValueOnce({ id: "b", name: "AA batteries", active: false, location: camp });
    await expect(addKitBulkMember("kit-1", { bulkSkuId: "b", quantity: 2 }, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 400, message: "AA batteries is archived and cannot be added to a kit" });

    tx.bulkSku.findUnique.mockResolvedValueOnce({ id: "b", name: "AA batteries", active: true, location: { name: "Kohl Center" } });
    await expect(addKitBulkMember("kit-1", { bulkSkuId: "b", quantity: 2 }, "u1", Role.STAFF))
      .rejects.toMatchObject({ status: 400, message: "AA batteries belongs to a different location than Camp Randall" });
    expect(tx.kitBulkMembership.upsert).not.toHaveBeenCalled();
  });

  it("sets the quantity for a family in the kit", async () => {
    tx.bulkSku.findUnique.mockResolvedValue({ id: "b", name: "AA batteries", active: true, location: { name: "Camp Randall Stadium" } });
    tx.kitBulkMembership.upsert.mockResolvedValue({ id: "bm1", quantity: 4 });

    expect(await addKitBulkMember("kit-1", { bulkSkuId: "b", quantity: 4 }, "u1", Role.STAFF)).toEqual({ id: "bm1", quantity: 4 });
    expect(tx.kitBulkMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { quantity: 4 } }));
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "bulk_member_added", after: { bulkSkuId: "b", quantity: 4, bulkSkuName: "AA batteries" } }));
  });

  it("removes a family only from its own kit", async () => {
    tx.kitBulkMembership.findUnique.mockResolvedValueOnce(null);
    await expect(removeKitBulkMember("kit-1", "bm1", "u1", Role.STAFF)).rejects.toMatchObject({ status: 404, message: "Bulk membership not found" });

    tx.kitBulkMembership.findUnique.mockResolvedValueOnce({ id: "bm1", kitId: "kit-1", bulkSkuId: "b", quantity: 4, bulkSku: { name: "AA batteries", unit: "each" } });
    await removeKitBulkMember("kit-1", "bm1", "u1", Role.STAFF);
    expect(tx.kitBulkMembership.delete).toHaveBeenCalledWith({ where: { id: "bm1" } });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "bulk_member_removed",
      before: { membershipId: "bm1", bulkSkuId: "b", bulkSkuName: "AA batteries", quantity: 4, unit: "each" },
    }));
  });
});

describe("kit reads", () => {
  it("returns 404 for an unknown kit and adds the shared pickup rooms", async () => {
    db.kit.findUnique.mockResolvedValueOnce(null);
    await expect(getKitDetail("nope")).rejects.toMatchObject({ status: 404 });

    db.kit.findUnique.mockResolvedValueOnce({ id: "kit-1", locationId: "loc-1", location: { name: "Kohl Center" } });
    expect(await getKitDetail("kit-1")).toEqual(expect.objectContaining({ id: "kit-1", pickupLocationIds: ["loc-1"] }));
  });

  it("refuses to plan an unknown, archived or wrong-pickup kit", async () => {
    tx.kit.findUnique.mockResolvedValueOnce(null);
    await expect(loadKitEquipmentPlan(tx as never, "nope", "loc-1")).rejects.toMatchObject({ status: 404 });

    tx.kit.findUnique.mockResolvedValueOnce({ id: "kit-1", name: "Slow 1", active: false });
    await expect(loadKitEquipmentPlan(tx as never, "kit-1", "loc-1"))
      .rejects.toMatchObject({ status: 400, message: "Slow 1 is archived and cannot be added to a booking" });

    tx.kit.findUnique.mockResolvedValueOnce({ id: "kit-1", name: "Slow 1", active: true, location: camp });
    tx.location.findUnique.mockResolvedValueOnce(null);
    await expect(loadKitEquipmentPlan(tx as never, "kit-1", "nope"))
      .rejects.toMatchObject({ status: 400, message: "Slow 1 belongs to Camp Randall, not this pickup location" });

    tx.kit.findUnique.mockResolvedValueOnce({ id: "kit-1", name: "Slow 1", active: true, location: camp });
    tx.location.findUnique.mockResolvedValueOnce({ name: "Kohl Center" });
    await expect(loadKitEquipmentPlan(tx as never, "kit-1", "loc-kohl")).rejects.toMatchObject({ status: 400 });
  });
});
