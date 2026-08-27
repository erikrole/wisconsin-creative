import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  GAME_RECORD_END_DATE,
  GAME_RECORD_START_DATE,
  gameRecordEventWhere,
  getWorkedEventCountForUser,
  getGameRecordForUser,
  workedEventWhere,
} from "@/lib/services/game-record";
import { scoreboardEventWhere } from "@/lib/services/scoreboard";

const mockedDb = db as unknown as {
  calendarEvent: { groupBy: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.calendarEvent.count.mockResolvedValue(0);
});

describe("workedEventWhere", () => {
  it("counts completed visible assigned events without requiring a result", () => {
    const where = workedEventWhere("user-1");

    expect(where.startsAt).toEqual({ gte: GAME_RECORD_START_DATE, lt: GAME_RECORD_END_DATE });
    expect(where.endsAt).toEqual({ lt: expect.any(Date) });
    expect(where.status).toBe("CONFIRMED");
    expect(where.isHidden).toBe(false);
    expect(where.archivedAt).toBeUndefined();
    expect(where.result).toBeUndefined();
    expect(where.NOT).toBeUndefined();
    expect(where.OR?.[0]?.shiftGroup?.shifts?.some?.assignments?.some).toEqual({
      userId: "user-1",
      status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
    });
    // An admin-added worker counts as worked without a shift.
    expect(where.OR?.[1]).toEqual({ workers: { some: { userId: "user-1" } } });
  });
});

describe("getWorkedEventCountForUser", () => {
  it("reads one event-level count for recap and recognition consumers", async () => {
    mockedDb.calendarEvent.count.mockResolvedValue(7);

    await expect(getWorkedEventCountForUser("user-1")).resolves.toBe(7);
    expect(mockedDb.calendarEvent.count).toHaveBeenCalledTimes(1);
    const args = mockedDb.calendarEvent.count.mock.calls[0]![0];
    expect(args.where.startsAt).toEqual({ gte: GAME_RECORD_START_DATE, lt: GAME_RECORD_END_DATE });
    expect(args.where.endsAt).toEqual({ lt: expect.any(Date) });
    expect(args.where.OR[0].shiftGroup.shifts.some.assignments.some.userId).toBe("user-1");
    expect(args.where.OR[1]).toEqual({ workers: { some: { userId: "user-1" } } });
  });
});

describe("gameRecordEventWhere", () => {
  it("counts only games that carry a source-derived outcome", () => {
    expect(gameRecordEventWhere("user-1").result).toEqual({ not: null });
  });

  it("bounds the record to the 2026-27 app-timezone season at both ends", () => {
    expect(gameRecordEventWhere("user-1").startsAt).toEqual({
      gte: GAME_RECORD_START_DATE,
      lt: GAME_RECORD_END_DATE,
    });
  });

  it("counts a game only once it has finished", () => {
    const now = new Date("2026-12-01T18:00:00.000Z");
    expect(gameRecordEventWhere("user-1", now).endsAt).toEqual({ lt: now });
  });

  it("agrees with the Scoreboard on which games are in the season", () => {
    // The profile chip and the Scoreboard tab describe the same season on the
    // same screen, so they cannot disagree about the window they cover.
    const now = new Date("2026-12-01T18:00:00.000Z");
    const record = gameRecordEventWhere("user-1", now);
    const scoreboard = scoreboardEventWhere("user-1");
    expect(record.startsAt).toEqual(scoreboard.startsAt);
    expect(record.status).toEqual(scoreboard.status);
    expect(record.archivedAt).toEqual(scoreboard.archivedAt);
    expect(record.isHidden).toEqual(scoreboard.isHidden);
    expect(record.NOT).toEqual(scoreboard.NOT);
  });

  it("excludes cancelled, hidden, and archived events", () => {
    const where = gameRecordEventWhere("user-1");
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.isHidden).toBe(false);
    expect(where.archivedAt).toBeNull();
  });

  it("keeps exhibitions and alumni matches out of the official record", () => {
    expect(gameRecordEventWhere("user-1").NOT).toEqual([
      { rawSummary: { contains: "exhibition", mode: "insensitive" } },
      { rawSummary: { contains: "scrimmage", mode: "insensitive" } },
      { rawSummary: { contains: "alumni match", mode: "insensitive" } },
    ]);
  });

  it("counts the user through an active shift assignment or an admin-added worker", () => {
    const where = gameRecordEventWhere("user-1");
    const assignment = where.OR?.[0]?.shiftGroup?.shifts?.some?.assignments?.some;
    expect(assignment?.userId).toBe("user-1");
    // Declined and swapped-away assignments are not assignments.
    expect(assignment?.status).toEqual({ in: ["DIRECT_ASSIGNED", "APPROVED"] });
    expect(where.OR?.[1]).toEqual({ workers: { some: { userId: "user-1" } } });
  });
});

describe("getGameRecordForUser", () => {
  it("tallies wins, losses, and ties from the grouped counts", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: "MBB", site: "HOME", _count: { _all: 12 } },
      { result: "LOSS", sportCode: "MBB", site: "AWAY", _count: { _all: 4 } },
      { result: "TIE", sportCode: "MBB", site: "HOME", _count: { _all: 2 } },
    ]);
    await expect(getGameRecordForUser("user-1")).resolves.toMatchObject({ wins: 12, losses: 4, ties: 2 });
  });

  it("returns a zero record when the user has no resolved games", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([]);
    await expect(getGameRecordForUser("user-1")).resolves.toEqual({ eventsWorked: 0, wins: 0, losses: 0, ties: 0, bySport: [], bySite: [] });
  });

  it("fills the missing side when every game went one way", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([{ result: "WIN", sportCode: "VB", site: "HOME", _count: { _all: 3 } }]);
    await expect(getGameRecordForUser("user-1")).resolves.toMatchObject({ wins: 3, losses: 0 });
  });

  it("keeps the all-event total separate from the official record", async () => {
    mockedDb.calendarEvent.count.mockResolvedValue(3);
    mockedDb.calendarEvent.groupBy.mockResolvedValue([{ result: "LOSS", sportCode: "VB", site: "HOME", _count: { _all: 1 } }]);

    await expect(getGameRecordForUser("user-1")).resolves.toMatchObject({ eventsWorked: 3, wins: 0, losses: 1 });
  });

  it("ignores an unexpected null bucket rather than miscounting it", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: null, sportCode: "MBB", site: "HOME", _count: { _all: 99 } },
      { result: "LOSS", sportCode: "MBB", site: "HOME", _count: { _all: 2 } },
    ]);
    await expect(getGameRecordForUser("user-1")).resolves.toMatchObject({ wins: 0, losses: 2 });
  });

  it("groups by event so one game with two shifts counts once", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([{ result: "WIN", sportCode: "MBB", site: "HOME", _count: { _all: 1 } }]);
    await getGameRecordForUser("user-1");
    const args = mockedDb.calendarEvent.groupBy.mock.calls[0]![0];
    expect(args.by).toEqual(["result", "sportCode", "site"]);
    expect(args._count).toEqual({ _all: true });
  });

  it("does not leak another user's games into the tally", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([]);
    await getGameRecordForUser("user-2");
    const args = mockedDb.calendarEvent.groupBy.mock.calls[0]![0];
    expect(args.where.OR[0].shiftGroup.shifts.some.assignments.some.userId).toBe("user-2");
  });
});

describe("getGameRecordForUser — counting dimensions", () => {
  it("splits the record by sport, most-played first", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: "MBB", site: "HOME", _count: { _all: 5 } },
      { result: "LOSS", sportCode: "MBB", site: "AWAY", _count: { _all: 3 } },
      { result: "WIN", sportCode: "VB", site: "HOME", _count: { _all: 2 } },
    ]);
    const record = await getGameRecordForUser("user-1");
    expect(record).toMatchObject({ wins: 7, losses: 3 });
    expect(record.bySport).toEqual([
      { sportCode: "MBB", wins: 5, losses: 3, ties: 0 },
      { sportCode: "VB", wins: 2, losses: 0, ties: 0 },
    ]);
  });

  it("counts neutral games as neutral instead of lumping them with unknown", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: "MROW", site: "NEUTRAL", _count: { _all: 4 } },
      { result: "LOSS", sportCode: "MROW", site: null, _count: { _all: 1 } },
      { result: "WIN", sportCode: "MROW", site: "HOME", _count: { _all: 2 } },
    ]);
    const record = await getGameRecordForUser("user-1");
    expect(record.bySite).toEqual([
      { site: "HOME", wins: 2, losses: 0, ties: 0 },
      { site: "NEUTRAL", wins: 4, losses: 0, ties: 0 },
      { site: null, wins: 0, losses: 1, ties: 0 },
    ]);
  });

  it("orders sites home, away, neutral, then unknown", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: "FB", site: null, _count: { _all: 1 } },
      { result: "WIN", sportCode: "FB", site: "NEUTRAL", _count: { _all: 1 } },
      { result: "WIN", sportCode: "FB", site: "AWAY", _count: { _all: 1 } },
      { result: "WIN", sportCode: "FB", site: "HOME", _count: { _all: 1 } },
    ]);
    const record = await getGameRecordForUser("user-1");
    expect(record.bySite.map((b) => b.site)).toEqual(["HOME", "AWAY", "NEUTRAL", null]);
  });

  it("keeps a game with no sport in its own bucket rather than dropping it", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: null, site: "HOME", _count: { _all: 2 } },
    ]);
    const record = await getGameRecordForUser("user-1");
    expect(record.wins).toBe(2);
    expect(record.bySport).toEqual([{ sportCode: null, wins: 2, losses: 0, ties: 0 }]);
  });

  it("counts one game once across both breakdowns", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      { result: "WIN", sportCode: "MBB", site: "HOME", _count: { _all: 6 } },
      { result: "LOSS", sportCode: "VB", site: "NEUTRAL", _count: { _all: 4 } },
    ]);
    const record = await getGameRecordForUser("user-1");
    const played = record.wins + record.losses + record.ties;
    const sumOf = (rows: Array<{ wins: number; losses: number; ties: number }>) =>
      rows.reduce((n, r) => n + r.wins + r.losses + r.ties, 0);
    expect(sumOf(record.bySport)).toBe(played);
    expect(sumOf(record.bySite)).toBe(played);
  });
});
