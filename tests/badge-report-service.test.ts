import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    studentBadge: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    badgeDefinition: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { getBadgeReport, parseBadgeReportPeriod } from "@/lib/services/badge-report";

const now = new Date("2026-10-25T17:00:00.000Z");
const awardedAt = new Date("2026-10-20T15:00:00.000Z");
const definitions = [
  { id: "d-ship", key: "ship", name: "Shipper", category: "MILESTONE", sortOrder: 1 },
  { id: "d-early", key: "early", name: "Early bird", category: "HABIT", sortOrder: 2 },
  { id: "d-alpha", key: "alpha", name: "Alpha", category: "HABIT", sortOrder: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.db.studentBadge.count
    .mockResolvedValueOnce(10)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(6)
    .mockResolvedValueOnce(2);
  mocks.db.badgeDefinition.findMany.mockImplementation(async ({ where }) => (where.active
    ? definitions
    : [{ id: "d-ship", key: "ship", name: "Shipper", category: "MILESTONE", active: true }]));
  mocks.db.studentBadge.groupBy.mockImplementation(async ({ by }) => (by[0] === "userId"
    ? [{ userId: "ada", _count: 5 }, { userId: "gone", _count: 2 }]
    : [{ definitionId: "d-ship", _count: 7 }, { definitionId: "d-old", _count: 1 }]));
  mocks.db.user.findMany.mockResolvedValue([{ id: "ada", name: "Ada", email: "ada@wisc.edu" }]);
  mocks.db.studentBadge.findMany.mockResolvedValue([
    { id: "a1", awardedAt, source: "MANUAL", note: "Great shoot", user: { id: "ada" }, definition: { id: "d-ship" }, awardedBy: { id: "s1", name: "Staff" } },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseBadgeReportPeriod", () => {
  it("accepts only the offered periods", () => {
    expect(parseBadgeReportPeriod("90")).toBe(90);
    expect(parseBadgeReportPeriod("365")).toBe(365);
    expect(parseBadgeReportPeriod("45")).toBe(30);
    expect(parseBadgeReportPeriod(null)).toBe(30);
  });
});

describe("getBadgeReport", () => {
  it("compares this period with the one before it", async () => {
    const report = await getBadgeReport(30);

    expect(mocks.db.studentBadge.count).toHaveBeenCalledWith({ where: { awardedAt: { gte: new Date("2026-09-25T17:00:00.000Z") } } });
    expect(mocks.db.studentBadge.count).toHaveBeenCalledWith({ where: { awardedAt: { gte: new Date("2026-08-26T17:00:00.000Z"), lt: new Date("2026-09-25T17:00:00.000Z") } } });
    expect(report).toEqual(expect.objectContaining({
      totalAwards: 10, manualAwards: 4, automaticAwards: 6, manualAwardRate: 0.4,
      days: 30, recentAwardCount: 6, previousRecentAwardCount: 2, activeDefinitionCount: 3,
    }));
  });

  it("names leaders and badges, with fallbacks for missing rows", async () => {
    const report = await getBadgeReport(30);

    expect(report.leaderboard).toEqual([
      { userId: "ada", name: "Ada", email: "ada@wisc.edu", count: 5 },
      { userId: "gone", name: "Unknown user", email: null, count: 2 },
    ]);
    expect(report.distribution).toEqual([
      { definitionId: "d-ship", key: "ship", name: "Shipper", category: "MILESTONE", active: true, count: 7 },
      { definitionId: "d-old", key: "unknown", name: "Unknown badge", category: "MILESTONE", active: false, count: 1 },
    ]);
    expect(report.recentAwards[0]).toEqual(expect.objectContaining({ id: "a1", awardedAt: awardedAt.toISOString(), note: "Great shoot" }));
  });

  it("lists the least-used active badges, ties by name", async () => {
    const report = await getBadgeReport(30);

    expect(report.underusedDefinitions.map((row) => [row.name, row.count])).toEqual([
      ["Alpha", 0],
      ["Early bird", 0],
      ["Shipper", 7],
    ]);
  });

  it("skips the lookups and reports a zero rate with no awards", async () => {
    mocks.db.studentBadge.count.mockReset().mockResolvedValue(0);
    mocks.db.studentBadge.groupBy.mockReset().mockResolvedValue([]);

    const report = await getBadgeReport();

    expect(report.manualAwardRate).toBe(0);
    expect(report.days).toBe(30);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.db.badgeDefinition.findMany).toHaveBeenCalledTimes(1);
  });
});
