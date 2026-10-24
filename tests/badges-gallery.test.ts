import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserBadgeProfile: vi.fn(),
  userFindMany: vi.fn(),
  awardFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: mocks.userFindMany },
    studentBadge: { findMany: mocks.awardFindMany },
  },
}));
vi.mock("@/lib/badges/queries", () => ({
  badgeEligibleUserWhere: { active: true, role: { not: "COLLABORATOR" } },
  getUserBadgeProfile: mocks.getUserBadgeProfile,
}));

import { getBadgeGallery } from "@/lib/badges/gallery";

type ProfileBadge = {
  id: string;
  key: string;
  earned: boolean;
  active?: boolean;
  holders?: number;
};

function profileBadge({ id, key, earned, active = true, holders = 0 }: ProfileBadge) {
  return {
    id,
    key,
    name: `Name ${key}`,
    description: `How to earn ${key}`,
    icon: "Trophy",
    category: "MILESTONE",
    kind: "COUNT",
    trigger: "checkout:opened",
    threshold: 5,
    active,
    sortOrder: 10,
    earned,
    awardedAt: earned ? "2026-10-01T12:00:00.000Z" : null,
    source: earned ? "AUTO" : null,
    progressCurrent: earned ? null : 2,
    progressTarget: earned ? null : 5,
    holders,
    rarity: "Rare",
    rarityProvisional: false,
  };
}

const award = (userId: string, definitionId: string) => ({
  userId,
  definitionId,
  awardedAt: new Date("2026-10-02T12:00:00.000Z"),
});

const viewer = { id: "me", role: "STUDENT" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([
    { id: "me", name: "Maya Chen", avatarUrl: null, role: "STUDENT" },
    { id: "sam", name: "Sam Ortiz", avatarUrl: null, role: "STUDENT" },
  ]);
});

describe("team badge gallery", () => {
  it("ranks people, lists holders, and keeps blooper holders private", async () => {
    mocks.getUserBadgeProfile.mockResolvedValue({
      peerVisible: true,
      badges: [
        profileBadge({ id: "d1", key: "first_checkout", earned: true }),
        profileBadge({ id: "d2", key: "glass_class", earned: false }),
        profileBadge({ id: "d3", key: "oops_damaged", earned: false }),
      ],
    });
    mocks.awardFindMany.mockResolvedValue([
      award("me", "d1"),
      award("sam", "d1"),
      award("sam", "d2"),
      award("sam", "d3"),
    ]);

    const gallery = await getBadgeGallery(viewer);

    expect(gallery.canCompare).toBe(true);
    // The blooper never counts toward a ranking.
    expect(gallery.people).toEqual([
      expect.objectContaining({ id: "sam", count: 2 }),
      expect.objectContaining({ id: "me", count: 1 }),
    ]);
    const byKey = new Map(gallery.badges.map((badge) => [badge.id, badge]));
    expect(byKey.get("d1")?.holders.map((holder) => holder.userId)).toEqual(["me", "sam"]);
    expect(byKey.get("d2")).toMatchObject({ earnedByViewer: false, holderCount: 1, progressCurrent: 2 });
    // oops_damaged is hidden until earned, so an unearned one is a mystery tile,
    // and whoever holds it is never listed.
    expect(byKey.get("d3")).toMatchObject({ mystery: true, privateHolders: true, holderCount: 1, holders: [] });
    expect(byKey.get("d3")?.name).toBe("Surprise badge");
    expect(JSON.stringify(byKey.get("d3"))).not.toContain("oops_damaged");
  });

  it("does not draw surprises nobody has found, and counts them instead", async () => {
    mocks.getUserBadgeProfile.mockResolvedValue({
      peerVisible: true,
      badges: [
        profileBadge({ id: "d1", key: "go_to_bed", earned: false }),
        profileBadge({ id: "d2", key: "leap_day", earned: false }),
        profileBadge({ id: "d3", key: "weekend_warrior", earned: true }),
      ],
    });
    mocks.awardFindMany.mockResolvedValue([award("sam", "d1"), award("me", "d3")]);

    const gallery = await getBadgeGallery(viewer);

    expect(gallery.badges.map((badge) => badge.id)).toEqual(["d1", "d3"]);
    expect(gallery.badges[0]).toMatchObject({ mystery: true, name: "Surprise badge" });
    // The viewer's own surprise is revealed to them.
    expect(gallery.badges[1]).toMatchObject({ mystery: false, key: "weekend_warrior" });
    expect(gallery.undiscoveredSurprises).toBe(1);
  });

  it("shows a student only themselves when peer visibility is off", async () => {
    mocks.getUserBadgeProfile.mockResolvedValue({
      peerVisible: false,
      badges: [profileBadge({ id: "d1", key: "first_checkout", earned: true, holders: 7 })],
    });
    mocks.userFindMany.mockResolvedValue([{ id: "me", name: "Maya Chen", avatarUrl: null, role: "STUDENT" }]);
    mocks.awardFindMany.mockResolvedValue([award("me", "d1")]);

    const gallery = await getBadgeGallery(viewer);

    expect(gallery.canCompare).toBe(false);
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "me" } }));
    expect(gallery.badges[0]).toMatchObject({ holderCount: 7, holders: [] });
  });

  it("always lets staff compare, and leaves retired badges out unless the viewer holds them", async () => {
    mocks.getUserBadgeProfile.mockResolvedValue({
      peerVisible: false,
      badges: [
        profileBadge({ id: "d1", key: "scan_10", earned: true, active: false }),
        profileBadge({ id: "d2", key: "scan_25", earned: false, active: false }),
      ],
    });
    mocks.awardFindMany.mockResolvedValue([award("me", "d1")]);

    const gallery = await getBadgeGallery({ id: "me", role: "STAFF" } as never);

    expect(gallery.canCompare).toBe(true);
    expect(gallery.badges.map((badge) => badge.id)).toEqual(["d1"]);
  });
});
