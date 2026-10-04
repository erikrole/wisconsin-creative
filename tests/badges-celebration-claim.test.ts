import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  groupBy: vi.fn(),
  userCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    studentBadge: {
      groupBy: mocks.groupBy,
    },
    user: {
      count: mocks.userCount,
    },
  },
}));

vi.mock("@/lib/badges/display", () => ({
  getBadgeRarityDetail: () => ({ rarity: "common", provisional: false }),
}));

import { listEarnedBadgesSince } from "@/lib/badges/queries";

describe("badge celebration claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupBy.mockResolvedValue([]);
    mocks.userCount.mockResolvedValue(40);
    mocks.transaction.mockImplementation(async (fn: (tx: {
      studentBadge: {
        findMany: typeof mocks.findMany;
        updateMany: typeof mocks.updateMany;
      };
    }) => Promise<unknown>) =>
      fn({
        studentBadge: {
          findMany: mocks.findMany,
          updateMany: mocks.updateMany,
        },
      }),
    );
  });

  it("claims uncelebrated awards so a later surface cannot replay them", async () => {
    const award = {
      id: "award-1",
      awardedAt: new Date("2026-10-04T12:00:00.000Z"),
      source: "AUTO",
      definition: {
        id: "def-1",
        key: "checkout_10",
        name: "Checkout Ten",
        description: "Opened ten checkouts.",
        icon: "Package",
        category: "MILESTONE",
        kind: "RULE",
        trigger: "checkout_opened",
        threshold: 10,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    };
    mocks.findMany.mockResolvedValueOnce([award]);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    const after = new Date("2026-10-04T11:00:00.000Z");
    const through = new Date("2026-10-04T12:30:00.000Z");
    const first = await listEarnedBadgesSince({ userId: "user-1", after, through });

    expect(first).toEqual([
      expect.objectContaining({
        id: "award-1",
        key: "checkout_10",
        name: "Checkout Ten",
      }),
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        celebratedAt: null,
        awardedAt: { gt: after, lte: through },
      }),
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ["award-1"] },
        celebratedAt: null,
      },
      data: { celebratedAt: expect.any(Date) },
    }));

    // A second delivery for the same window finds nothing left to claim.
    mocks.findMany.mockResolvedValueOnce([]);
    const second = await listEarnedBadgesSince({ userId: "user-1", after, through });
    expect(second).toEqual([]);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when every matching award was already celebrated", async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    await expect(listEarnedBadgesSince({
      userId: "user-1",
      after: new Date("2026-10-04T11:00:00.000Z"),
      through: new Date("2026-10-04T12:30:00.000Z"),
    })).resolves.toEqual([]);

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });
});
