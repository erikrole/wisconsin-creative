import type { TeamScoreboard, TeamScoreboardBreakdown } from "@/lib/services/team-scoreboard";
import type { TeamScoreboardFilterKey } from "@/lib/scoreboard-explorer";
import { rateLabel, recordLabel } from "@/lib/scoreboard-digest";

/**
 * A fun fact is one big value and one plain sentence, computed only from the
 * aggregate the page already loaded. Its action says what tapping it explores.
 */
export type ScoreboardFunFactAction =
  | { type: "person"; userId: string }
  | { type: "filter"; key: TeamScoreboardFilterKey; value: string };

export type ScoreboardFunFact = {
  id: string;
  label: string;
  value: string;
  sentence: string;
  action: ScoreboardFunFactAction | null;
};

/** Facts that judge a record need a little more than the ranking minimum to mean anything. */
const FUN_FACT_MINIMUM_GAMES = 4;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function mostCovered(rows: TeamScoreboardBreakdown[]): TeamScoreboardBreakdown | null {
  return rows
    .filter((row) => row.key !== null && row.eventsCovered > 0)
    .sort((a, b) => b.eventsCovered - a.eventsCovered || b.games - a.games || a.label.localeCompare(b.label))[0] ?? null;
}

function bestRecord(rows: TeamScoreboardBreakdown[], minimumGames: number): TeamScoreboardBreakdown | null {
  return rows
    .filter((row) => row.key !== null && row.winRate !== null && row.games >= minimumGames)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.games - a.games || a.label.localeCompare(b.label))[0] ?? null;
}

export function scoreboardFunFacts(
  scoreboard: Pick<TeamScoreboard, "summary" | "leaderboard" | "bySport" | "byVenue" | "byOpponent" | "bySite" | "filters" | "methodology">,
  currentUserId: string | null,
): ScoreboardFunFact[] {
  const facts: ScoreboardFunFact[] = [];
  const people = scoreboard.leaderboard;
  if (people.length === 0) return facts;

  const byEvents = [...people].sort((a, b) =>
    b.summary.eventsWorked - a.summary.eventsWorked
    || b.summary.games - a.summary.games
    || a.name.localeCompare(b.name));
  const leader = byEvents[0];
  if (leader && leader.summary.eventsWorked > 0) {
    facts.push({
      id: "iron-crew",
      label: "Iron crew",
      value: plural(leader.summary.eventsWorked, "event"),
      sentence: `${leader.name} has worked more events than anyone.`,
      action: { type: "person", userId: leader.userId },
    });
  }

  const runnerUp = byEvents[1];
  if (leader && runnerUp && leader.summary.eventsWorked - runnerUp.summary.eventsWorked <= 2) {
    const gap = leader.summary.eventsWorked - runnerUp.summary.eventsWorked;
    facts.push({
      id: "tight-race",
      label: "Tight at the top",
      value: gap === 0 ? "Tied" : `${gap} ${gap === 1 ? "event" : "events"} apart`,
      sentence: gap === 0
        ? `${firstName(leader.name)} and ${firstName(runnerUp.name)} are level on events.`
        : `${firstName(runnerUp.name)} is chasing ${firstName(leader.name)} for most events.`,
      action: { type: "person", userId: runnerUp.userId },
    });
  }

  const teamRate = scoreboard.summary.winRate;
  const charm = people
    .filter((person) => person.summary.winRate !== null && person.summary.games >= FUN_FACT_MINIMUM_GAMES)
    .sort((a, b) =>
      (b.summary.winRate ?? 0) - (a.summary.winRate ?? 0)
      || b.summary.games - a.summary.games
      || a.name.localeCompare(b.name))[0];
  if (charm && (teamRate === null || (charm.summary.winRate ?? 0) > teamRate)) {
    facts.push({
      id: "lucky-charm",
      label: "Lucky charm",
      value: recordLabel(charm.summary),
      sentence: `The team is ${rateLabel(charm.summary.winRate)} when ${firstName(charm.name)} is on crew.`,
      action: { type: "person", userId: charm.userId },
    });
  }

  const home = scoreboard.bySite.find((row) => row.key === "HOME");
  const away = scoreboard.bySite.find((row) => row.key === "AWAY");
  if (!scoreboard.filters.site && home?.winRate != null && away?.winRate != null && home.games > 0 && away.games > 0) {
    const better = home.winRate >= away.winRate ? home : away;
    facts.push({
      id: "home-away",
      label: better === home ? "Home cooking" : "Road warriors",
      value: rateLabel(better.winRate),
      sentence: `${recordLabel(home)} at home, ${recordLabel(away)} away.`,
      action: { type: "filter", key: "site", value: better.key ?? "HOME" },
    });
  }

  if (!scoreboard.filters.opponent) {
    const rival = mostCovered(scoreboard.byOpponent);
    if (rival && rival.eventsCovered >= 2) {
      facts.push({
        id: "familiar-face",
        label: "Familiar face",
        value: rival.label,
        sentence: `${plural(rival.eventsCovered, "event")} against them so far${rival.games > 0 ? `, ${recordLabel(rival)}` : ""}.`,
        action: { type: "filter", key: "opponent", value: rival.key ?? rival.label },
      });
    }
  }

  if (!scoreboard.filters.sportCode && scoreboard.bySport.length > 1) {
    const sport = bestRecord(scoreboard.bySport, scoreboard.methodology.minimumGamesForWinRate);
    if (sport) {
      facts.push({
        id: "hot-sport",
        label: "Hottest sport",
        value: sport.label,
        sentence: `${recordLabel(sport)} with our crew there, ${rateLabel(sport.winRate)}.`,
        action: { type: "filter", key: "sportCode", value: sport.key ?? sport.label },
      });
    }
  }

  if (!scoreboard.filters.venue) {
    const venue = mostCovered(scoreboard.byVenue);
    if (venue && venue.eventsCovered >= 2) {
      facts.push({
        id: "second-home",
        label: "Second home",
        value: venue.label,
        sentence: `The most-worked venue, ${plural(venue.eventsCovered, "event")}.`,
        action: { type: "filter", key: "venue", value: venue.key ?? venue.label },
      });
    }
  }

  if (scoreboard.summary.eventsCovered > 0) {
    const crew = scoreboard.summary.eventCredits / scoreboard.summary.eventsCovered;
    facts.push({
      id: "crew-size",
      label: "Average crew",
      value: `${Math.round(crew * 10) / 10} people`,
      sentence: `Across ${plural(scoreboard.summary.eventsCovered, "event")} and ${plural(scoreboard.summary.contributors, "person", "people")}.`,
      action: null,
    });
  }

  const youIndex = currentUserId ? byEvents.findIndex((person) => person.userId === currentUserId) : -1;
  const you = youIndex >= 0 ? byEvents[youIndex] : undefined;
  const ahead = youIndex > 0 ? byEvents[youIndex - 1] : undefined;
  if (you && ahead) {
    const gap = ahead.summary.eventsWorked - you.summary.eventsWorked;
    facts.unshift({
      id: "your-spot",
      label: "Your spot",
      value: `#${youIndex + 1}`,
      sentence: gap === 0
        ? `Level with ${firstName(ahead.name)} on events.`
        : `${plural(gap, "event")} behind ${firstName(ahead.name)}.`,
      action: { type: "person", userId: you.userId },
    });
  } else if (you) {
    facts.unshift({
      id: "your-spot",
      label: "Your spot",
      value: "#1",
      sentence: "Nobody has worked more events than you.",
      action: { type: "person", userId: you.userId },
    });
  }

  return facts;
}

/** A stable window into the facts, so shuffling walks through them instead of repeating. */
export function funFactWindow<T>(facts: T[], page: number, size: number): T[] {
  if (facts.length <= size) return facts;
  const start = (page * size) % facts.length;
  return Array.from({ length: size }, (_, index) => facts[(start + index) % facts.length]!);
}
