import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  SCOREBOARD_SCOPE,
  getScoreboardForUser,
  scoreboardEventWhere,
} from "@/lib/services/scoreboard";

const mockedDb = db as unknown as {
  calendarEvent: {
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.calendarEvent.findMany.mockResolvedValue([]);
  mockedDb.calendarEvent.count.mockResolvedValue(0);
});

describe("scoreboardEventWhere", () => {
  it("keeps the season boundary and active-assignment contract together", () => {
    const where = scoreboardEventWhere("user-1", { sportCode: "SB", result: "WIN" });

    expect(where.result).toBe("WIN");
    expect(where.startsAt).toEqual({ gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt });
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.isHidden).toBe(false);
    expect(where.archivedAt).toBeNull();
    expect(where.NOT).toEqual([
      { rawSummary: { contains: "exhibition", mode: "insensitive" } },
      { rawSummary: { contains: "scrimmage", mode: "insensitive" } },
      { rawSummary: { contains: "alumni match", mode: "insensitive" } },
    ]);
    expect(where.sportCode).toBe("SB");
    expect(where.OR).toEqual([
      {
        shiftGroup: {
          shifts: {
            some: {
              assignments: {
                some: { userId: "user-1", status: { in: ["DIRECT_ASSIGNED", "APPROVED"] } },
              },
            },
          },
        },
      },
      { workers: { some: { userId: "user-1" } } },
    ]);
  });

  it("narrows to one site when the reader asks for home, away, or neutral", () => {
    expect(scoreboardEventWhere("user-1", { site: "AWAY" }).site).toBe("AWAY");
    // No site filter must never become a filter for "site unknown".
    expect(scoreboardEventWhere("user-1")).not.toHaveProperty("site");
  });

  it("counts an admin-added worker the same way it counts an assignment", () => {
    const where = scoreboardEventWhere("user-1");
    const [assigned, added] = where.OR ?? [];

    expect(where).not.toHaveProperty("result");
    expect(where.endsAt).toEqual({ lt: expect.any(Date) });
    expect(assigned).toHaveProperty("shiftGroup");
    expect(added).toEqual({ workers: { some: { userId: "user-1" } } });
  });
});

describe("getScoreboardForUser", () => {
  it("aggregates every requested dimension and preserves event-level pagination", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      {
        result: "WIN",
        sportCode: "SB",
        site: "HOME",
        opponent: "Minnesota",
        rawLocationText: "Madison, Wis., UW Field House",
        _count: { _all: 2 },
      },
      {
        result: "LOSS",
        sportCode: "SB",
        site: "AWAY",
        opponent: "Minnesota",
        rawLocationText: "Madison, WI, McClimon Track/Soccer Complex",
        _count: { _all: 1 },
      },
      {
        result: null,
        sportCode: null,
        site: null,
        opponent: null,
        rawLocationText: null,
        _count: { _all: 1 },
      },
      {
        result: "TIE",
        sportCode: "SB",
        site: "HOME",
        opponent: "Minnesota",
        rawLocationText: "Madison, Wis., UW Field House",
        _count: { _all: 1 },
      },
      {
        result: "WIN",
        sportCode: null,
        site: null,
        opponent: null,
        rawLocationText: null,
        _count: { _all: 1 },
      },
    ]);
    mockedDb.calendarEvent.count.mockResolvedValue(7);
    mockedDb.calendarEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        startsAt: new Date("2026-09-01T18:00:00.000Z"),
        allDay: false,
        result: "WIN",
        sportCode: "SB",
        opponent: "Minnesota",
        site: "HOME",
        rawLocationText: "Madison, Wis., UW Field House",
        shiftGroup: {
          shifts: [
            { area: "LIVE_PRODUCTION" },
            { area: "PHOTO" },
            { area: "VIDEO" },
            { area: "PHOTO" },
          ],
        },
      },
      {
        id: "event-2",
        startsAt: new Date("2026-08-01T18:00:00.000Z"),
        allDay: false,
        result: "LOSS",
        sportCode: "SB",
        opponent: "Minnesota",
        site: "AWAY",
        rawLocationText: "Madison, WI, McClimon Track/Soccer Complex",
        shiftGroup: { shifts: [{ area: "VIDEO" }] },
      },
    ]);

    const scoreboard = await getScoreboardForUser("user-1", {}, { offset: 0, limit: 1 });
    const eventSelect = mockedDb.calendarEvent.findMany.mock.calls[0]?.[0]?.select;

    expect(scoreboard.summary).toEqual({ eventsWorked: 7, wins: 3, losses: 1, ties: 1, games: 5, winRate: 70 });
    expect(scoreboard.eventCount).toBe(7);
    expect(scoreboard.bySport[0]).toMatchObject({ label: "Softball", wins: 2, losses: 1, ties: 1, games: 4, winRate: 62.5 });
    expect(scoreboard.byOpponent[0]).toMatchObject({ label: "Minnesota", wins: 2, losses: 1, ties: 1, games: 4 });
    expect(scoreboard.bySite.map((bucket) => bucket.label)).toEqual(["Home", "Away", "Unknown site"]);
    expect(scoreboard.byVenue.map((bucket) => bucket.label)).toEqual([
      "UW Field House",
      "McClimon Track/Soccer Complex",
      "Unknown venue",
    ]);
    expect(scoreboard.events).toHaveLength(1);
    expect(scoreboard.events[0]).toMatchObject({
      id: "event-1",
      result: "WIN",
      sportLabel: "Softball",
      shiftAreas: ["VIDEO", "PHOTO", "LIVE_PRODUCTION"],
      venue: "UW Field House",
    });
    expect(eventSelect).not.toHaveProperty("location");
    expect(scoreboard.nextCursor).toBe("1");
  });

  it("lists a completed worked event without inventing a result or breakdown", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([
      {
        result: null,
        sportCode: null,
        site: null,
        opponent: null,
        rawLocationText: null,
        _count: { _all: 1 },
      },
    ]);
    mockedDb.calendarEvent.count.mockResolvedValue(1);
    mockedDb.calendarEvent.findMany.mockResolvedValue([
      {
        id: "event-past",
        summary: "Veterans Plaza Ceremony",
        startsAt: new Date("2026-08-25T21:30:00.000Z"),
        allDay: false,
        result: null,
        sportCode: null,
        opponent: null,
        site: null,
        rawLocationText: null,
        shiftGroup: { shifts: [{ area: "VIDEO" }] },
      },
    ]);

    const scoreboard = await getScoreboardForUser("user-1");

    expect(scoreboard.summary).toMatchObject({ eventsWorked: 1, wins: 0, losses: 0, ties: 0, games: 0 });
    expect(scoreboard.eventCount).toBe(1);
    expect(scoreboard.bySport).toEqual([]);
    expect(scoreboard.events).toEqual([
      expect.objectContaining({
        id: "event-past",
        summary: "Veterans Plaza Ceremony",
        result: null,
        sportLabel: null,
        shiftAreas: ["VIDEO"],
      }),
    ]);
  });

  it("returns a zero record without inventing breakdowns", async () => {
    mockedDb.calendarEvent.groupBy.mockResolvedValue([]);

    await expect(getScoreboardForUser("user-1")).resolves.toMatchObject({
      summary: { eventsWorked: 0, wins: 0, losses: 0, ties: 0, games: 0, winRate: null },
      bySport: [],
      byOpponent: [],
      bySite: [],
      byVenue: [],
      events: [],
      eventCount: 0,
      nextCursor: null,
    });
  });
});
