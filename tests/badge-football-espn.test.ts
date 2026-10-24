import { describe, expect, it } from "vitest";
import { shiftAutomaticRuleCounts, type ShiftBadgeEvidence } from "@/lib/badges/automatic-rules";
import type { FootballScore } from "@/lib/football-results";
import { source } from "./_helpers/source";

const TZ = "America/Chicago";
const details: { wisconsinRank: number | null; opponentRank: number | null; overtimes: number; networks: string[] } = {
  wisconsinRank: null, opponentRank: null, overtimes: 0, networks: [],
};

function verified(wisconsin: number, opponent: number, extra: Partial<typeof details> = {}): FootballScore {
  return { status: "verified", wisconsin, opponent, margin: wisconsin - opponent, stale: false, sources: [],
    details: { ...details, ...extra } };
}

function game(id: string, finalScore: FootballScore | null, kickoff = "2026-09-12T17:00:00Z", sportCode = "FB"): ShiftBadgeEvidence {
  return {
    callStartsAt: null, callEndsAt: null,
    shift: {
      startsAt: new Date(kickoff), endsAt: new Date(new Date(kickoff).getTime() + 4 * 3600_000),
      callStartsAt: null, callEndsAt: null, area: "VIDEO",
      shiftGroup: { event: { id, isHome: true, sportCode, result: "WIN", startsAt: new Date(kickoff), allDay: false, finalScore } },
    },
  };
}

const keys = ["shift_football_one_score", "shift_football_ranked_win", "shift_football_ranked_games",
  "shift_football_overtime", "shift_football_prime", "shift_football_shutout"];
const counts = (rows: ShiftBadgeEvidence[]) => Object.fromEntries(keys.map((key) => [key, shiftAutomaticRuleCounts(rows, TZ).get(key)]));

describe("ESPN football badge rules", () => {
  it("counts a close game, a ranked win, overtime, a shutout and a night game from verified finals", () => {
    expect(counts([game("a", verified(24, 20, { opponentRank: 13, overtimes: 1 }))])).toMatchObject({
      shift_football_one_score: 0, shift_football_ranked_win: 1, shift_football_ranked_games: 1, shift_football_overtime: 1 });
    expect(counts([game("b", verified(23, 20))]).shift_football_one_score).toBe(1);
    expect(counts([game("c", verified(31, 0))]).shift_football_shutout).toBe(1);
    // 7:30 p.m. Central is 00:30Z; a 12 p.m. kickoff on TV is not prime time.
    expect(counts([game("d", verified(10, 7, { networks: ["NBC"] }), "2026-10-25T00:30:00Z")]).shift_football_prime).toBe(1);
    expect(counts([game("e", verified(10, 7, { networks: ["BTN"] }), "2026-10-03T17:00:00Z")]).shift_football_prime).toBe(0);
    expect(counts([game("f", verified(10, 7), "2026-10-25T00:30:00Z")]).shift_football_prime).toBe(0);
  });
  it("gives a loss to a ranked team a game toward Top 25 Regular but no Giant Killer", () => {
    expect(counts([game("a", verified(7, 17, { opponentRank: 12 }))])).toMatchObject({
      shift_football_ranked_win: 0, shift_football_ranked_games: 1, shift_football_one_score: 0 });
  });
  it("counts nothing for an unverified score, a non-football event or no score", () => {
    const disputed = { ...verified(10, 0), status: "disputed" as const, details: null };
    expect(Object.values(counts([game("a", disputed), game("b", null), game("c", verified(10, 0), undefined, "VB")])).every((n) => n === 0)).toBe(true);
  });
  it("counts each game once even with several shifts, and ranked games across games", () => {
    const ranked = (id: string) => game(id, verified(20, 10, { opponentRank: 5 }));
    expect(counts([ranked("a"), ranked("a"), ranked("b"), ranked("c")]).shift_football_ranked_games).toBe(3);
  });
  it("seeds a migration for exactly these rules", () => {
    const migration = source("prisma/migrations/0207_badge_espn_football/migration.sql");
    for (const key of keys) expect(migration).toContain(`'${key}'`);
  });
});
