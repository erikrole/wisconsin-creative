import { calendarDate } from "@/lib/format";
import type { ScoreboardBucket, ScoreboardEvent, UserScoreboard } from "@/lib/services/scoreboard";

export type ScoreboardMonth = { key: string; label: string; games: ScoreboardEvent[] };
export type ScoreboardStreak = { count: number; isWin: boolean; label: string };
export type ScoreboardHighlight = { id: string; label: string; value: string; detail: string };

/** "4–2". One owner so a bucket row and the season summary never spell the same record two ways. */
export function recordLabel(bucket: Pick<ScoreboardBucket, "wins" | "losses">): string {
  return `${bucket.wins}–${bucket.losses}`;
}

/** The route has already rounded to one decimal; a missing rate is a dash, not a zero. */
export function rateLabel(rate: number | null): string {
  return rate == null ? "—" : `${rate}%`;
}

export function gamesLabel(games: number): string {
  return `${games} ${games === 1 ? "game" : "games"}`;
}

/**
 * Games grouped under their month heading, preserving the route's newest-first
 * order both between groups and inside them. A season reads by month; a flat
 * list of forty games does not say when the busy stretch was.
 */
export function groupByMonth(games: ScoreboardEvent[]): ScoreboardMonth[] {
  const order: string[] = [];
  const grouped = new Map<string, ScoreboardEvent[]>();
  const labels = new Map<string, string>();

  for (const game of games) {
    const date = calendarDate(game.startsAt, game.allDay);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "undated";
    if (!grouped.has(key)) {
      order.push(key);
      labels.set(key, valid ? date.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Undated");
      grouped.set(key, []);
    }
    grouped.get(key)!.push(game);
  }

  return order.map((key) => ({ key, label: labels.get(key) ?? key, games: grouped.get(key) ?? [] }));
}

/** The most recent results, newest first — the order the route already returns. */
export function recentForm(games: ScoreboardEvent[], limit = 5): ScoreboardEvent[] {
  return games.slice(0, limit);
}

/**
 * Offset pagination can repeat a game when a newly resolved result moves the
 * following rows between requests. Keep the first occurrence and preserve the
 * server's newest-first order so React keys and visible counts stay stable.
 */
export function mergeScoreboardEvents(...pages: ScoreboardEvent[][]): ScoreboardEvent[] {
  const seen = new Set<string>();
  return pages.flatMap((page) => page.filter((game) => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  }));
}

/**
 * The current run, or null when the last two games disagree. A run of one is
 * not a streak and does not get announced as one.
 */
export function currentStreak(games: ScoreboardEvent[]): ScoreboardStreak | null {
  const first = games[0];
  if (!first) return null;
  const isWin = first.result === "WIN";
  let count = 0;
  for (const game of games) {
    if ((game.result === "WIN") !== isWin) break;
    count += 1;
  }
  if (count < 2) return null;
  return { count, isWin, label: `${count} straight ${isWin ? "wins" : "losses"}` };
}

/**
 * Three facts worth reading before the tables: what this person works most,
 * where they win most, and who they see most. Empty when the season has no
 * resolved games to draw them from.
 */
export function scoreboardHighlights(scoreboard: UserScoreboard): ScoreboardHighlight[] {
  if (scoreboard.summary.games === 0) return [];
  const highlights: ScoreboardHighlight[] = [];

  const sport = scoreboard.bySport[0];
  if (sport) {
    highlights.push({ id: "sport", label: "Most worked", value: sport.label, detail: gamesLabel(sport.games) });
  }

  // Rank sustained success by win margin, then rate and volume. A perfect
  // one-game sample should not outrank a venue where the person is 6–1.
  const bestVenue = scoreboard.byVenue
    .filter((bucket) => bucket.key !== null)
    .reduce<ScoreboardBucket | null>((best, bucket) => {
      if (!best) return bucket;
      const margin = bucket.wins - bucket.losses;
      const bestMargin = best.wins - best.losses;
      if (margin > bestMargin) return bucket;
      if (margin < bestMargin) return best;
      const rate = bucket.winRate ?? -1;
      const bestRate = best.winRate ?? -1;
      if (rate > bestRate) return bucket;
      if (rate < bestRate) return best;
      if (rate === bestRate && bucket.games > best.games) return bucket;
      return best;
    }, null);
  if (bestVenue) {
    highlights.push({
      id: "venue",
      label: "Best venue",
      value: bestVenue.label,
      detail: `${recordLabel(bestVenue)} · ${rateLabel(bestVenue.winRate)}`,
    });
  }

  // The unknown-opponent bucket is a real table row and never a highlight:
  // "Top matchup: Unknown opponent" says nothing.
  const opponent = scoreboard.byOpponent.find((bucket) => bucket.key !== null);
  if (opponent) {
    highlights.push({
      id: "opponent",
      label: "Top matchup",
      value: opponent.label,
      detail: `${recordLabel(opponent)} · ${gamesLabel(opponent.games)}`,
    });
  }

  return highlights;
}

/**
 * Events worked counts every event with an active assignment; the record counts
 * only the ones that finished with a result. Two different numbers that used to
 * sit side by side as if they were the same kind of thing — and under a filter
 * they are not even measuring the same set, so the filtered sentence says which
 * is which rather than joining them.
 */
export function totalsSentence(input: {
  eventsWorked: number;
  resolvedGames: number;
  isFiltered: boolean;
  seasonResolvedGames: number | null;
}): string {
  const events = input.eventsWorked === 1 ? "1 event" : `${input.eventsWorked} events`;
  if (input.isFiltered) {
    const shown = input.resolvedGames === 1 ? "1 game" : `${input.resolvedGames} games`;
    if (input.seasonResolvedGames == null) {
      return `Filtered to ${shown}. Events worked counts all ${input.eventsWorked} this season.`;
    }
    return `Filtered to ${shown} of the season's ${input.seasonResolvedGames} resolved. `
      + `Events worked counts all ${input.eventsWorked}.`;
  }
  if (input.resolvedGames === 0) {
    return `${events} worked this season, none with a recorded result yet.`;
  }
  return `${events} worked this season, ${input.resolvedGames} with a recorded result.`;
}
