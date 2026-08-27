import { describe, expect, it } from "vitest";
import {
  currentStreak,
  groupByMonth,
  mergeScoreboardEvents,
  recentForm,
  scoreboardHighlights,
  totalsSentence,
} from "@/lib/scoreboard-digest";
import type { ScoreboardBucket, ScoreboardEvent, UserScoreboard } from "@/lib/services/scoreboard";

function game(id: string, startsAt: string, result: "WIN" | "LOSS" | "TIE"): ScoreboardEvent {
  return {
    id,
    summary: `Event ${id}`,
    startsAt,
    allDay: false,
    result,
    sportCode: "FB",
    sportLabel: "Football",
    opponent: "Iowa",
    site: "HOME",
    venue: "Camp Randall Stadium",
    shiftAreas: ["VIDEO"],
  };
}

function bucket(key: string | null, label: string, wins: number, losses: number, winRate: number | null): ScoreboardBucket {
  return { key, label, wins, losses, ties: 0, games: wins + losses, winRate };
}

function scoreboard(overrides: Partial<UserScoreboard> = {}): UserScoreboard {
  return {
    scope: {
      key: "2026-27",
      label: "2026–27 season",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2027-07-01T00:00:00.000Z",
      timeZone: "America/Chicago",
    },
    summary: { eventsWorked: 38, wins: 14, losses: 12, ties: 0, games: 26, winRate: 53.8 },
    bySport: [bucket("FB", "Football", 6, 2, 75), bucket("VB", "Volleyball", 3, 3, 50)],
    byOpponent: [bucket(null, "Unknown opponent", 3, 3, 50), bucket("Purdue", "Purdue", 4, 0, 100)],
    bySite: [],
    byVenue: [
      bucket("Camp Randall Stadium", "Camp Randall Stadium", 6, 1, 85.7),
      bucket("Kohl Center", "Kohl Center", 1, 0, 100),
    ],
    events: [],
    eventCount: 38,
    nextCursor: null,
    ...overrides,
  };
}

describe("scoreboard digest", () => {
  it("groups games by month in the order the route returned them", () => {
    const months = groupByMonth([
      game("a", "2026-12-05T18:00:00.000Z", "WIN"),
      game("b", "2026-11-28T19:00:00.000Z", "WIN"),
      game("c", "2026-11-07T20:00:00.000Z", "LOSS"),
      game("d", "2026-10-31T18:00:00.000Z", "LOSS"),
    ]);

    expect(months.map((month) => month.label)).toEqual(["December 2026", "November 2026", "October 2026"]);
    expect(months.map((month) => month.games.length)).toEqual([1, 2, 1]);
    expect(months[0]?.games[0]?.id).toBe("a");
  });

  it("needs two games for a streak and stops at the first disagreement", () => {
    const games = [
      game("a", "2026-12-05T18:00:00.000Z", "WIN"),
      game("b", "2026-11-28T19:00:00.000Z", "WIN"),
      game("c", "2026-11-07T20:00:00.000Z", "LOSS"),
    ];

    expect(currentStreak(games)).toEqual({ count: 2, result: "WIN", isWin: true, label: "2 straight wins" });
    // A single game is not a streak and must not be announced as one.
    expect(currentStreak([games[0]!, games[2]!])).toBeNull();
    expect(currentStreak([])).toBeNull();
  });

  it("takes only the most recent games for form", () => {
    const games = Array.from({ length: 8 }, (_, index) =>
      game(`g${index}`, `2026-11-0${index + 1}T18:00:00.000Z`, index % 2 === 0 ? "WIN" : "LOSS"),
    );

    expect(recentForm(games).map((entry) => entry.id)).toEqual(["g0", "g1", "g2", "g3", "g4"]);
    expect(recentForm(games, 2).map((entry) => entry.id)).toEqual(["g0", "g1"]);
  });

  it("treats a tie as its own result for form and streaks", () => {
    const games = [
      game("a", "2026-12-05T18:00:00.000Z", "TIE"),
      game("b", "2026-11-28T19:00:00.000Z", "TIE"),
      game("c", "2026-11-07T20:00:00.000Z", "WIN"),
    ];

    expect(currentStreak(games)).toEqual({ count: 2, result: "TIE", isWin: false, label: "2 straight ties" });
  });

  it("does not turn a worked event without a result into a tie streak", () => {
    const workedEvent: ScoreboardEvent = {
      id: "event",
      summary: "Veterans Plaza Ceremony",
      startsAt: "2026-12-05T18:00:00.000Z",
      allDay: false,
      result: null,
      sportCode: null,
      sportLabel: null,
      opponent: null,
      site: null,
      venue: null,
      shiftAreas: ["VIDEO"],
    };

    expect(currentStreak([workedEvent, workedEvent])).toBeNull();
  });

  it("keeps worked events out of the resolved-results form strip", () => {
    const workedEvent: ScoreboardEvent = {
      id: "worked",
      summary: "Veterans Plaza Ceremony",
      startsAt: "2026-12-05T18:00:00.000Z",
      allDay: false,
      result: null,
      sportCode: null,
      sportLabel: null,
      opponent: null,
      site: null,
      venue: null,
      shiftAreas: ["VIDEO"],
    };

    expect(recentForm([workedEvent, game("resolved", "2026-12-04T18:00:00.000Z", "WIN")]).map((entry) => entry.id))
      .toEqual(["resolved"]);
  });

  it("merges paged events without repeating a row that moved between offsets", () => {
    const first = [
      game("a", "2026-12-05T18:00:00.000Z", "WIN"),
      game("b", "2026-11-28T19:00:00.000Z", "LOSS"),
    ];
    const second = [
      game("b", "2026-11-28T19:00:00.000Z", "LOSS"),
      game("c", "2026-11-07T20:00:00.000Z", "WIN"),
    ];

    expect(mergeScoreboardEvents(first, second).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("picks sustained venue success instead of a perfect one-game sample and skips unknown buckets", () => {
    const highlights = scoreboardHighlights(scoreboard());

    expect(highlights.map((highlight) => highlight.id)).toEqual(["sport", "venue", "opponent"]);
    expect(highlights[0]?.detail).toBe("8 games");
    // A lone 1–0 at the Kohl Center does not outrank a sustained 6–1 at Camp Randall.
    expect(highlights[1]?.value).toBe("Camp Randall Stadium");
    expect(highlights[1]?.detail).toBe("6–1 · 85.7%");
    // "Top matchup: Unknown opponent" says nothing.
    expect(highlights[2]?.value).toBe("Purdue");
  });

  it("has no highlights without resolved games", () => {
    const empty = scoreboard({
      summary: { eventsWorked: 4, wins: 0, losses: 0, ties: 0, games: 0, winRate: null },
    });

    expect(scoreboardHighlights(empty)).toEqual([]);
  });

  it("keeps the two season totals apart, filtered or not", () => {
    expect(totalsSentence({ eventsWorked: 38, resolvedGames: 26, isFiltered: false, seasonResolvedGames: 26 }))
      .toBe("38 events worked this season, 26 with a recorded result.");
    expect(totalsSentence({ eventsWorked: 4, resolvedGames: 0, isFiltered: false, seasonResolvedGames: 0 }))
      .toBe("4 events worked this season, none with a recorded result yet.");
    // Under a filter the two numbers measure different sets, so the sentence
    // names which is which instead of joining them.
    expect(totalsSentence({ eventsWorked: 38, resolvedGames: 3, isFiltered: true, seasonResolvedGames: 26 }))
      .toBe("Filtered to 3 games of the season's 26 resolved. Events worked counts all 38.");
    // Before an unfiltered read has landed, the season total is unknown and the
    // sentence must not invent one.
    expect(totalsSentence({ eventsWorked: 38, resolvedGames: 3, isFiltered: true, seasonResolvedGames: null }))
      .toBe("Filtered to 3 games. Events worked counts all 38 this season.");
  });
});
