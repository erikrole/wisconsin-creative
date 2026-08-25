import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    badgeDefinition: {
      findMany: vi.fn(),
    },
    badgeStreak: {
      findMany: vi.fn(),
    },
    badgeEventReceipt: {
      findMany: vi.fn(),
    },
    booking: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    shiftTrade: {
      count: vi.fn(),
    },
    shiftAssignment: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    eventWorker: {
      findMany: vi.fn(),
    },
    studentBadge: {
      createMany: vi.fn(),
      groupBy: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getBadgeCatalog } from "@/app/api/badges/route";
import { GET as getUserBadges } from "@/app/api/badges/user/[userId]/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@example.com",
  name: "Student",
  role: "STUDENT" as const,
  avatarUrl: null,
};

function makeGetRequest(url = "https://app.example.com/api/badges") {
  return new Request(url, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function badgeDefinitionRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.badgeDefinition.findMany>>;
}

function userRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function systemConfigRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.systemConfig.findUnique>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BADGES_ENABLED = "true";
  vi.mocked(db.booking.count).mockResolvedValue(0);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
  vi.mocked(db.shiftTrade.count).mockResolvedValue(0);
  vi.mocked(db.badgeStreak.findMany).mockResolvedValue([]);
  vi.mocked(db.badgeEventReceipt.findMany).mockResolvedValue([]);
  vi.mocked(db.shiftAssignment.count).mockResolvedValue(0);
  vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([]);
  vi.mocked(db.eventWorker.findMany).mockResolvedValue([]);
  vi.mocked(db.studentBadge.createMany).mockResolvedValue({ count: 0 });
  // Rarity is served from real holder counts now, so the profile query reads
  // award totals and the eligible population alongside the definitions.
  vi.mocked(db.studentBadge.groupBy).mockResolvedValue([] as never);
  vi.mocked(db.user.count).mockResolvedValue(0);
});

describe("GET /api/badges", () => {
  it("returns before badge queries when badges are disabled", async () => {
    process.env.BADGES_ENABLED = "false";
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await getBadgeCatalog(makeGetRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [], disabled: true });
    expect(db.badgeDefinition.findMany).not.toHaveBeenCalled();
  });

  it("returns active badge definitions", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue(badgeDefinitionRows([
      {
        id: "definition-1",
        key: "first_checkout",
        name: "First Checkout",
        description: "Complete your first kiosk checkout.",
        icon: "PackageCheck",
        category: "CHECKOUT",
        kind: "COUNT",
        trigger: "checkout:opened",
        threshold: 1,
        ruleKey: null,
        active: true,
        sortOrder: 10,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
      },
    ]));

    const res = await getBadgeCatalog(makeGetRequest(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([
      expect.objectContaining({
        key: "first_checkout",
        active: true,
      }),
    ]);
    expect(db.badgeDefinition.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });
});

describe("GET /api/badges/user/[userId]", () => {
  it("returns before badge profile queries when badges are disabled", async () => {
    process.env.BADGES_ENABLED = "false";
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      userId: "student-1",
      peerVisible: false,
      earnedCount: 0,
      totalCount: 0,
      badges: [],
      disabled: true,
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.systemConfig.findUnique).not.toHaveBeenCalled();
    expect(db.badgeDefinition.findMany).not.toHaveBeenCalled();
  });

  it("returns active and historically earned inactive badges for visible users", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(systemConfigRow({ key: "badges.peerVisible", value: false }));
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue(badgeDefinitionRows([
      {
        id: "definition-1",
        key: "first_checkout",
        name: "First Checkout",
        description: "Complete your first kiosk checkout.",
        icon: "PackageCheck",
        category: "CHECKOUT",
        kind: "COUNT",
        trigger: "checkout:opened",
        threshold: 1,
        ruleKey: null,
        active: true,
        sortOrder: 10,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [{
          id: "award-1",
          awardedAt: new Date("2026-05-09T13:00:00.000Z"),
          source: "AUTO",
          note: null,
        }],
      },
      {
        id: "definition-2",
        key: "retired_badge",
        name: "Retired Badge",
        description: "Historical award.",
        icon: "Trophy",
        category: "MILESTONE",
        kind: "RULE",
        trigger: "manual",
        threshold: null,
        ruleKey: null,
        active: false,
        sortOrder: 20,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [],
      },
    ]));

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.earnedCount).toBe(1);
    expect(body.data.totalCount).toBe(1);
    expect(body.data.badges[0]).toEqual(expect.objectContaining({
      key: "first_checkout",
      earned: true,
      awardedAt: "2026-05-09T13:00:00.000Z",
      progressCurrent: 0,
      progressTarget: 1,
    }));
    expect(db.badgeDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { active: true },
          { awards: { some: { userId: "student-1" } } },
        ],
      },
      include: expect.objectContaining({
        awards: expect.objectContaining({
          where: { userId: "student-1" },
          take: 1,
        }),
      }),
    }));
  });

  it("returns real progress for supported threshold badges", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue(badgeDefinitionRows([
      {
        id: "definition-1",
        key: "checkout_5",
        name: "Gear Regular",
        description: "Opened five gear checkouts.",
        icon: "PackageOpen",
        category: "CHECKOUT",
        kind: "COUNT",
        trigger: "checkout:opened",
        threshold: 5,
        ruleKey: null,
        active: true,
        sortOrder: 20,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [],
      },
      {
        id: "definition-2",
        key: "perfect_handoff",
        name: "Perfect Handoff",
        description: "Returned a checkout on time with everything accounted for.",
        icon: "ShieldCheck",
        category: "ON_TIME",
        kind: "RULE",
        trigger: "manual",
        threshold: null,
        ruleKey: "perfect_handoff",
        active: true,
        sortOrder: 140,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [],
      },
    ]));
    vi.mocked(db.badgeEventReceipt.findMany).mockResolvedValue([
      { sourceKey: "booking-1" },
      { sourceKey: "booking-2" },
      { sourceKey: "booking-3" },
    ] as never);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.badges[0]).toEqual(expect.objectContaining({
      key: "checkout_5",
      progressCurrent: 3,
      progressTarget: 5,
    }));
    expect(body.data.badges[1]).toEqual(expect.objectContaining({
      key: "perfect_handoff",
      progressCurrent: null,
      progressTarget: null,
    }));
  });

  it("serves rarity from real holder counts and surfaces streaks", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue(badgeDefinitionRows([
      {
        id: "definition-common",
        key: "zero_errors",
        name: "Zero Errors",
        description: "Ten clean scans in a row.",
        icon: "ShieldCheck",
        category: "SCAN",
        kind: "RULE",
        trigger: "scan:rule",
        threshold: 10,
        ruleKey: "zero_errors",
        active: true,
        sortOrder: 240,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [],
      },
      {
        id: "definition-unearned",
        key: "checkout_25",
        name: "Gear Veteran",
        description: "Opened 25 gear checkouts.",
        icon: "Boxes",
        category: "CHECKOUT",
        kind: "COUNT",
        trigger: "checkout:opened",
        threshold: 25,
        ruleKey: null,
        active: true,
        sortOrder: 30,
        createdAt: new Date("2026-05-09T12:00:00.000Z"),
        awards: [],
      },
    ]));
    // Ten of fourteen people hold zero_errors; nobody holds checkout_25.
    vi.mocked(db.studentBadge.groupBy).mockResolvedValue([
      { definitionId: "definition-common", _count: { userId: 10 } },
    ] as never);
    vi.mocked(db.user.count).mockResolvedValue(14);
    vi.mocked(db.badgeStreak.findMany).mockResolvedValue([
      { streakType: "ON_TIME_RETURN", current: 4, longest: 7, lastEventAt: new Date("2026-07-20T12:00:00.000Z") },
      // Never surfaced: this one is a durable counter, not a run.
      { streakType: "SCAN_SUCCESS_COUNT", current: 31, longest: 31, lastEventAt: null },
      { streakType: "SCAN_CLEAN", current: 31, longest: 31, lastEventAt: null },
    ] as never);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    // The hardcoded table called this one Uncommon while it was among the most
    // widely held badges in the system.
    expect(body.data.badges[0]).toEqual(expect.objectContaining({
      key: "zero_errors",
      holders: 10,
      rarity: "Common",
    }));
    // And this one Common, with nobody holding it. Unearned is unproven, so it
    // is rated by difficulty rather than crowned the rarest thing in the app.
    expect(body.data.badges[1]).toEqual(expect.objectContaining({
      key: "checkout_25",
      holders: 0,
      rarity: "Uncommon",
    }));

    expect(body.data.streaks).toEqual([
      { type: "ON_TIME_RETURN", current: 4, longest: 7, lastEventAt: "2026-07-20T12:00:00.000Z" },
    ]);
  });

  it("repairs a completed automatic badge before returning the profile", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    const locked = {
      id: "definition-1",
      key: "first_shift",
      name: "On Duty",
      description: "Was assigned to a first completed event shift.",
      icon: "CalendarClock",
      category: "SHIFT",
      kind: "COUNT",
      trigger: "shift:completed",
      threshold: 1,
      ruleKey: null,
      active: true,
      sortOrder: 310,
      createdAt: new Date("2026-05-09T12:00:00.000Z"),
      awards: [],
    };
    const earned = {
      ...locked,
      awards: [{
        id: "award-1",
        awardedAt: new Date("2026-08-10T12:00:00.000Z"),
        source: "AUTO",
        note: null,
        awardedBy: null,
      }],
    };
    vi.mocked(db.badgeDefinition.findMany)
      .mockResolvedValueOnce(badgeDefinitionRows([locked]))
      .mockResolvedValueOnce(badgeDefinitionRows([earned]));
    vi.mocked(db.shiftAssignment.findMany).mockResolvedValue([{
      callStartsAt: null,
      callEndsAt: null,
      shift: {
        startsAt: new Date("2026-08-10T15:00:00.000Z"),
        endsAt: new Date("2026-08-10T18:00:00.000Z"),
        callStartsAt: null,
        callEndsAt: null,
        shiftGroup: { event: { id: "event-1", isHome: true } },
      },
    }] as never);
    vi.mocked(db.studentBadge.createMany).mockResolvedValue({ count: 1 });

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    // Dated from the shift that met the threshold, not from this request. A
    // repair stamped `now()` claimed on the shelf that months-old work had just
    // happened, and -- because the recent-awards feed selects by `awardedAt` --
    // fired a celebration triggered by whoever opened the profile.
    expect(db.studentBadge.createMany).toHaveBeenCalledWith({
      data: [{
        userId: "student-1",
        definitionId: "definition-1",
        awardedAt: new Date("2026-08-10T18:00:00.000Z"),
      }],
      skipDuplicates: true,
    });
    expect(body.data.badges[0]).toEqual(expect.objectContaining({
      key: "first_shift",
      earned: true,
      progressCurrent: 1,
      progressTarget: 1,
    }));
  });

  it("repairs a completed captured-data badge instead of returning it locked", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    const locked = {
      id: "definition-power-player",
      key: "power_player",
      name: "Power Player",
      description: "Checked out gear with batteries ten times.",
      icon: "BatteryCharging",
      category: "MILESTONE",
      kind: "COUNT",
      trigger: "checkout:opened",
      threshold: 10,
      ruleKey: "checkout_family_batteries",
      active: true,
      sortOrder: 770,
      createdAt: new Date("2026-08-10T12:00:00.000Z"),
      awards: [],
    };
    const earned = {
      ...locked,
      awards: [{
        id: "award-power-player",
        awardedAt: new Date("2026-08-10T13:00:00.000Z"),
        source: "AUTO",
        note: null,
        awardedBy: null,
      }],
    };
    vi.mocked(db.badgeDefinition.findMany)
      .mockResolvedValueOnce(badgeDefinitionRows([locked]))
      .mockResolvedValueOnce(badgeDefinitionRows([earned]));
    vi.mocked(db.badgeEventReceipt.findMany).mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        sourceKey: `booking-${index + 1}`,
        receivedAt: new Date(`2026-0${index < 9 ? "3" : "4"}-1${index % 9}T12:00:00.000Z`),
      })) as never,
    );
    vi.mocked(db.booking.findMany).mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        serializedItems: [{
          asset: { category: { id: `battery-${index}`, name: "Batteries", parent: null } },
        }],
        bulkItems: [],
      })) as never,
    );
    vi.mocked(db.studentBadge.createMany).mockResolvedValue({ count: 1 });

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    // A distinct-count rule has no "Nth event" to point at, so the repair falls
    // back to the latest evidence the user has. That is an upper bound rather
    // than the exact moment, but it is always in the past, which is the
    // property that keeps a repair from masquerading as a fresh award.
    expect(db.studentBadge.createMany).toHaveBeenCalledWith({
      data: [{
        userId: "student-1",
        definitionId: "definition-power-player",
        awardedAt: new Date("2026-04-10T12:00:00.000Z"),
      }],
      skipDuplicates: true,
    });
    expect(body.data.badges[0]).toEqual(expect.objectContaining({
      key: "power_player",
      earned: true,
      progressCurrent: 10,
      progressTarget: 10,
    }));
  });

  it("blocks peer students when badge peer visibility is disabled", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...studentUser, id: "student-2" });
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(systemConfigRow({ key: "badges.peerVisible", value: false }));

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });

    expect(res.status).toBe(403);
    expect(db.badgeDefinition.findMany).not.toHaveBeenCalled();
  });

  it("allows peer students when badge peer visibility is enabled", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...studentUser, id: "student-2" });
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "student-1", role: "STUDENT", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue([]);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/student-1"), {
      params: Promise.resolve({ userId: "student-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.peerVisible).toBe(true);
  });

  it("returns badge profiles for staff users too", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "staff-1", role: "STAFF", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(systemConfigRow({ key: "badges.peerVisible", value: false }));
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue([]);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/staff-1"), {
      params: Promise.resolve({ userId: "staff-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.userId).toBe("staff-1");
    expect(db.badgeDefinition.findMany).toHaveBeenCalled();
  });

  it("allows users to compare staff badges when peer visibility is enabled", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findUnique).mockResolvedValue(userRow({ id: "staff-1", role: "STAFF", active: true }));
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.badgeDefinition.findMany).mockResolvedValue([]);

    const res = await getUserBadges(makeGetRequest("https://app.example.com/api/badges/user/staff-1"), {
      params: Promise.resolve({ userId: "staff-1" }),
    });

    expect(res.status).toBe(200);
  });
});
