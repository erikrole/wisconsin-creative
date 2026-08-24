import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    calendarEvent: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  getTeamScoreboard,
  type TeamScoreboardPersonIdentity,
} from "@/lib/services/team-scoreboard";
import { SCOREBOARD_SCOPE } from "@/lib/services/scoreboard";

const mockedFindMany = db.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;

const alice: TeamScoreboardPersonIdentity = {
  id: "alice",
  name: "Alice Adams",
  avatarUrl: "/alice.jpg",
};

const bob: TeamScoreboardPersonIdentity = {
  id: "bob",
  name: "Bob Brown",
  avatarUrl: null,
};

function event(
  id: string,
  sportCode: string | null,
  result: "WIN" | "LOSS" | null,
  shifts: TeamScoreboardPersonIdentity[][],
  dimensions: {
    opponent?: string | null;
    site?: "HOME" | "AWAY" | "NEUTRAL" | null;
    rawLocationText?: string | null;
    credits?: TeamScoreboardPersonIdentity[];
  } = {},
) {
  return {
    id,
    sportCode,
    opponent: dimensions.opponent ?? null,
    site: dimensions.site ?? null,
    rawLocationText: dimensions.rawLocationText ?? null,
    result,
    shiftGroup: {
      shifts: shifts.map((people) => ({
        assignments: people.map((user) => ({ user })),
      })),
    },
    credits: (dimensions.credits ?? []).map((user) => ({ user })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTeamScoreboard", () => {
  it("counts an admin-recorded credit like an assignment and never twice", async () => {
    mockedFindMany
      .mockResolvedValueOnce([
        // Bob was never staffed on this event; an admin credited him after the
        // fact. Alice holds both a shift and a redundant credit.
        event("worked-fb", "FB", null, [[alice]], { credits: [alice, bob] }),
        // Nobody was assigned at all -- the credit alone makes it covered.
        event("worked-sb", "SB", null, [], { credits: [bob] }),
      ])
      .mockResolvedValueOnce([
        event("game-fb-win", "FB", "WIN", [[alice]], { credits: [alice, bob] }),
      ]);

    const scoreboard = await getTeamScoreboard({ now: new Date("2026-12-01T18:00:00.000Z") });

    expect(scoreboard.summary).toMatchObject({
      contributors: 2,
      eventsCovered: 2,
      // Alice once and Bob once on the football event, Bob once on softball.
      eventCredits: 3,
      wins: 1,
      losses: 0,
      games: 1,
      gameCredits: 2,
    });
    expect(scoreboard.leaderboard.map((person) => person.userId).sort()).toEqual(["alice", "bob"]);
    expect(scoreboard.leaderboard.find((person) => person.userId === "bob")?.summary).toMatchObject({
      eventsWorked: 2,
      wins: 1,
      losses: 0,
      games: 1,
    });
    expect(scoreboard.leaderboard.find((person) => person.userId === "alice")?.summary).toMatchObject({
      eventsWorked: 1,
      wins: 1,
      games: 1,
    });
  });


  it("aggregates unique coverage and per-person credits without N+1 reads", async () => {
    mockedFindMany
      .mockResolvedValueOnce([
        // Alice has two shifts on this event but earns one event credit.
        event("worked-fb", "FB", null, [[alice], [alice, bob]]),
        event("worked-sb", "SB", null, [[alice]]),
      ])
      .mockResolvedValueOnce([
        // The same deduplication applies to record credits.
        event("game-fb-win", "FB", "WIN", [[alice], [alice, bob]]),
        event("game-fb-loss", "FB", "LOSS", [[bob]]),
        event("game-sb-win", "SB", "WIN", [[alice]]),
      ]);

    const now = new Date("2026-12-01T18:00:00.000Z");
    const scoreboard = await getTeamScoreboard({ now });

    expect(mockedFindMany).toHaveBeenCalledTimes(2);
    expect(scoreboard.summary).toEqual({
      contributors: 2,
      eventsCovered: 2,
      eventCredits: 3,
      wins: 2,
      losses: 1,
      games: 3,
      winRate: 66.7,
      gameCredits: 4,
    });

    expect(scoreboard.leaderboard.map((person) => person.userId)).toEqual(["alice", "bob"]);
    expect(scoreboard.leaderboard[0]).toMatchObject({
      userId: "alice",
      name: "Alice Adams",
      avatarUrl: "/alice.jpg",
      summary: { eventsWorked: 2, wins: 2, losses: 0, games: 2, winRate: 100 },
    });
    expect(scoreboard.leaderboard[1]).toMatchObject({
      userId: "bob",
      summary: { eventsWorked: 1, wins: 1, losses: 1, games: 2, winRate: 50 },
    });

    expect(scoreboard.bySport).toEqual([
      expect.objectContaining({
        key: "FB",
        label: "Football",
        contributors: 2,
        eventsCovered: 1,
        eventCredits: 2,
        wins: 1,
        losses: 1,
        games: 2,
        gameCredits: 3,
      }),
      expect.objectContaining({
        key: "SB",
        label: "Softball",
        contributors: 1,
        eventsCovered: 1,
        eventCredits: 1,
        wins: 1,
        losses: 0,
        games: 1,
        gameCredits: 1,
      }),
    ]);

    const workedWhere = mockedFindMany.mock.calls[0]?.[0]?.where;
    expect(workedWhere).toMatchObject({
      startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
      endsAt: { lt: now },
      status: "CONFIRMED",
      isHidden: false,
    });
    const officialWhere = mockedFindMany.mock.calls[1]?.[0]?.where;
    expect(officialWhere).toMatchObject({
      result: { not: null },
      startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
      status: { not: "CANCELLED" },
      isHidden: false,
      archivedAt: null,
    });

    for (const call of mockedFindMany.mock.calls) {
      const query = call[0];
      expect(query.where.OR[0].shiftGroup.shifts.some.assignments.some).toMatchObject({
        status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
        user: { active: true, hiddenFromRoster: false },
      });
      expect(query.where.OR[1].credits.some).toEqual({
        user: { active: true, hiddenFromRoster: false },
      });
      expect(query.select.shiftGroup.select.shifts.select.assignments.select.user.select).toEqual({
        id: true,
        name: true,
        avatarUrl: true,
      });
      expect(query.select).toMatchObject({
        opponent: true,
        site: true,
        rawLocationText: true,
      });
    }
  });

  it("recomputes every total and breakdown from stacked filters while keeping stable facets", async () => {
    mockedFindMany
      .mockResolvedValueOnce([
        event("vb-field-house", "VB", null, [[alice, bob]], {
          opponent: "Minnesota",
          site: "HOME",
          rawLocationText: "Madison, WI, UW Field House",
        }),
        event("vb-kohl", "VB", null, [[alice]], {
          opponent: "Iowa",
          site: "HOME",
          rawLocationText: "Madison, WI, Kohl Center",
        }),
        event("mbb-road", "MBB", null, [[bob]], {
          opponent: "Iowa",
          site: "AWAY",
          rawLocationText: "Iowa City, IA, Carver-Hawkeye Arena",
        }),
      ])
      .mockResolvedValueOnce([
        event("vb-field-house", "VB", "WIN", [[alice, bob]], {
          opponent: "Minnesota",
          site: "HOME",
          rawLocationText: "Madison, WI, UW Field House",
        }),
        event("vb-kohl", "VB", "LOSS", [[alice]], {
          opponent: "Iowa",
          site: "HOME",
          rawLocationText: "Madison, WI, Kohl Center",
        }),
        event("mbb-road", "MBB", "LOSS", [[bob]], {
          opponent: "Iowa",
          site: "AWAY",
          rawLocationText: "Iowa City, IA, Carver-Hawkeye Arena",
        }),
      ]);

    const scoreboard = await getTeamScoreboard({
      now: new Date("2026-12-01T18:00:00.000Z"),
      filters: {
        sportCode: "VB",
        venue: "UW Field House",
        opponent: "Minnesota",
        site: "HOME",
      },
    });

    expect(scoreboard.filters).toEqual({
      sportCode: "VB",
      venue: "UW Field House",
      opponent: "Minnesota",
      site: "HOME",
    });
    expect(scoreboard.summary).toEqual({
      contributors: 2,
      eventsCovered: 1,
      eventCredits: 2,
      wins: 1,
      losses: 0,
      games: 1,
      winRate: 100,
      gameCredits: 2,
    });
    expect(scoreboard.leaderboard.map((person) => person.userId)).toEqual(["alice", "bob"]);
    expect(scoreboard.bySport).toEqual([
      expect.objectContaining({ key: "VB", eventsCovered: 1, wins: 1, losses: 0 }),
    ]);
    expect(scoreboard.byVenue).toEqual([
      expect.objectContaining({ key: "UW Field House", eventsCovered: 1, wins: 1, losses: 0 }),
    ]);
    expect(scoreboard.byOpponent).toEqual([
      expect.objectContaining({ key: "Minnesota", eventsCovered: 1, wins: 1, losses: 0 }),
    ]);
    expect(scoreboard.bySite).toEqual([
      expect.objectContaining({ key: "HOME", eventsCovered: 1, wins: 1, losses: 0 }),
    ]);

    // Facets describe the full bounded window, so another dimension remains
    // selectable even after the current intersection narrows to one event.
    expect(scoreboard.facets.sports.map((facet) => facet.key)).toEqual(["MBB", "VB"]);
    expect(scoreboard.facets.venues.map((facet) => facet.key)).toEqual([
      "Carver-Hawkeye Arena",
      "Kohl Center",
      "UW Field House",
    ]);
    expect(scoreboard.facets.opponents.map((facet) => facet.key)).toEqual(["Iowa", "Minnesota"]);
    expect(scoreboard.facets.sites.map((facet) => facet.key)).toEqual(["HOME", "AWAY"]);
  });

  it("returns an explicit empty season without inventing leaders", async () => {
    mockedFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(getTeamScoreboard({ now: new Date("2026-12-01T18:00:00.000Z") })).resolves.toMatchObject({
      summary: {
        contributors: 0,
        eventsCovered: 0,
        eventCredits: 0,
        wins: 0,
        losses: 0,
        games: 0,
        winRate: null,
        gameCredits: 0,
      },
      filters: { sportCode: null, venue: null, opponent: null, site: null },
      facets: { sports: [], venues: [], opponents: [], sites: [] },
      bySport: [],
      byVenue: [],
      byOpponent: [],
      bySite: [],
      leaderboard: [],
    });
  });
});
