import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn() },
    badgeDefinition: { findUnique: vi.fn(), create: vi.fn() },
    studentBadge: { findUnique: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (client: typeof tx) => unknown)(tx) : arg)),
      studentBadge: { findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), delete: vi.fn(() => "delete-op") },
      notification: { deleteMany: vi.fn(() => "notification-op") },
      user: { count: vi.fn() },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { awardBadgeManually, ensureManualBadgeDefinition, listEarnedBadgesSince, revokeStudentBadge } from "@/lib/badges/queries";

const { tx, db } = mocks;
const definition = { id: "def-1", key: "custom_clutch_shooter", name: "Clutch shooter", active: true };

beforeEach(() => {
  vi.clearAllMocks();
  tx.badgeDefinition.findUnique.mockResolvedValue(null);
  tx.badgeDefinition.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "def-new", key: data.key, name: data.name, active: true }));
  tx.user.findUnique.mockResolvedValue({ id: "ada", name: "Ada", role: "STUDENT", active: true, notificationPrefs: null });
  tx.studentBadge.findUnique.mockResolvedValue(null);
  tx.studentBadge.create.mockResolvedValue({ id: "award-1" });
});

describe("listEarnedBadgesSince", () => {
  const window = { userId: "ada", after: new Date("2026-10-24T00:00:00Z"), through: new Date("2026-10-25T00:00:00Z") };

  it("returns nothing when no uncelebrated award is claimed", async () => {
    db.$queryRaw.mockResolvedValue([]);

    expect(await listEarnedBadgesSince(window)).toEqual([]);
    expect(db.studentBadge.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing when the claimed rows vanished", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "award-1" }]);
    db.studentBadge.findMany.mockResolvedValue([]);

    expect(await listEarnedBadgesSince(window)).toEqual([]);
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it("describes each claimed award with its rarity", async () => {
    const awardedAt = new Date("2026-10-24T18:00:00Z");
    db.$queryRaw.mockResolvedValue([{ id: "award-1" }]);
    db.studentBadge.findMany.mockResolvedValue([{
      id: "award-1",
      awardedAt,
      source: "AUTOMATIC",
      definition: { id: "def-1", key: "first_checkout", name: "First checkout", description: "d", icon: "Trophy", category: "MILESTONE", kind: "RULE", trigger: "checkout:opened", threshold: 1, createdAt: new Date("2026-01-01") },
    }]);
    db.studentBadge.groupBy.mockResolvedValue([{ definitionId: "def-1", _count: { userId: 3 } }]);
    db.user.count.mockResolvedValue(30);

    const [badge] = await listEarnedBadgesSince(window);

    expect(badge).toEqual(expect.objectContaining({ id: "award-1", definitionId: "def-1", key: "first_checkout", source: "AUTOMATIC", awardedAt: awardedAt.toISOString() }));
    expect(badge?.rarity).toEqual(expect.any(String));
    expect(db.studentBadge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["award-1"] } } }));
  });
});

describe("ensureManualBadgeDefinition", () => {
  it("creates a custom badge from a slug of its name", async () => {
    const result = await ensureManualBadgeDefinition({ name: "  Clutch Shooter!! ", description: " Big shot ", icon: " " } as never);

    expect(result).toEqual(expect.objectContaining({ key: "custom_clutch_shooter" }));
    expect(tx.badgeDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: "custom_clutch_shooter", name: "Clutch Shooter!!", description: "Big shot", icon: "Trophy", trigger: "manual", ruleKey: "custom_clutch_shooter" }),
    }));
  });

  it("reuses a custom badge that already exists", async () => {
    tx.badgeDefinition.findUnique.mockResolvedValue(definition);

    expect(await ensureManualBadgeDefinition({ name: "Clutch shooter", description: "" } as never)).toBe(definition);
    expect(tx.badgeDefinition.create).not.toHaveBeenCalled();
  });

  it("refuses a name with no letters or numbers, and an archived badge", async () => {
    await expect(ensureManualBadgeDefinition({ name: "!!!", description: "" } as never)).rejects.toMatchObject({ status: 400, message: "Custom badge name is required" });

    tx.badgeDefinition.findUnique.mockResolvedValue({ ...definition, active: false });
    await expect(ensureManualBadgeDefinition({ name: "Clutch shooter", description: "" } as never)).rejects.toMatchObject({ status: 404 });
  });
});

describe("awardBadgeManually", () => {
  it("refuses an inactive person, an unknown badge and a repeat award", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ id: "ada", active: false });
    await expect(awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff" } as never)).rejects.toMatchObject({ status: 404, message: "Active user not found" });

    await expect(awardBadgeManually({ userId: "ada", awardedById: "staff" } as never)).rejects.toMatchObject({ status: 404, message: "Active badge definition not found" });

    tx.badgeDefinition.findUnique.mockResolvedValue(definition);
    tx.studentBadge.findUnique.mockResolvedValueOnce({ id: "award-0" });
    await expect(awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff" } as never)).rejects.toMatchObject({ status: 409 });
  });

  it("turns a racing duplicate into the same 409", async () => {
    tx.badgeDefinition.findUnique.mockResolvedValue(definition);
    tx.studentBadge.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));

    await expect(awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff" } as never)).rejects.toMatchObject({ status: 409, message: "Badge already awarded" });
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it("passes other create errors through", async () => {
    tx.badgeDefinition.findUnique.mockResolvedValue(definition);
    tx.studentBadge.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" }));

    await expect(awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff" } as never)).rejects.toMatchObject({ code: "P2003" });
  });

  it("notifies the person unless they turned badge alerts off", async () => {
    tx.badgeDefinition.findUnique.mockResolvedValue(definition);

    await awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff", note: "  " } as never);
    expect(tx.studentBadge.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: "MANUAL", note: null }) }));
    expect(tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ body: "You earned Clutch shooter.", dedupeKey: "badge_awarded_award-1" }) });

    tx.notification.create.mockClear();
    tx.user.findUnique.mockResolvedValue({ id: "ada", active: true, notificationPrefs: { badges: false } });
    await awardBadgeManually({ userId: "ada", definitionId: "def-1", awardedById: "staff" } as never);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

describe("revokeStudentBadge", () => {
  it("refuses an unknown or automatic award", async () => {
    db.studentBadge.findUnique.mockResolvedValueOnce(null);
    await expect(revokeStudentBadge({ studentBadgeId: "nope", revokedById: "staff" })).rejects.toMatchObject({ status: 404 });

    db.studentBadge.findUnique.mockResolvedValueOnce({ id: "award-1", source: "AUTOMATIC" });
    await expect(revokeStudentBadge({ studentBadgeId: "award-1", revokedById: "staff" })).rejects.toMatchObject({ status: 409, message: "Only manually awarded badges can be revoked" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("deletes a manual award and its notification together", async () => {
    db.studentBadge.findUnique.mockResolvedValue({ id: "award-1", source: "MANUAL", userId: "ada", definitionId: "def-1" });

    await revokeStudentBadge({ studentBadgeId: "award-1", revokedById: "staff" });

    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { dedupeKey: "badge_awarded_award-1" } });
    expect(db.$transaction).toHaveBeenCalledWith(["delete-op", "notification-op"]);
  });
});
