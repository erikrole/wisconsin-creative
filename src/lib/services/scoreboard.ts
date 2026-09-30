import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sportLabel } from "@/lib/sports";
import { normalizeOpponentName, scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import {
  GAME_RECORD_END_DATE,
  GAME_RECORD_START_DATE,
  gameRecordEventWhere,
  workedEventWhere,
} from "@/lib/services/game-record";
import type { CalendarEventResult, CalendarEventSite, Prisma } from "@prisma/client";
import { siteLabel, winRate } from "@/lib/scoreboard-display";

const SCOREBOARD_SEASON_KEY = "2026-27";
export const SCOREBOARD_SCOPE = {
  key: SCOREBOARD_SEASON_KEY,
  label: "Current season",
  startsAt: GAME_RECORD_START_DATE,
  endsAt: GAME_RECORD_END_DATE,
  timeZone: env.appTimezone,
} as const;

export type ScoreboardResult = Extract<CalendarEventResult, "WIN" | "LOSS" | "TIE">;
type ScoreboardSite = CalendarEventSite | null;

type ScoreboardFilters = {
  sportCode?: string;
  result?: ScoreboardResult;
  site?: CalendarEventSite;
  venue?: string;
  opponent?: string;
};

export type ScoreboardFacet = { key: string; label: string };
export type ScoreboardFacets = {
  sports: ScoreboardFacet[];
  venues: ScoreboardFacet[];
  opponents: ScoreboardFacet[];
};

export type ScoreboardBucket = {
  key: string | null;
  label: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  winRate: number | null;
};

export type ScoreboardEvent = {
  id: string;
  summary: string;
  startsAt: string;
  allDay: boolean;
  result: ScoreboardResult | null;
  sportCode: string | null;
  sportLabel: string | null;
  opponent: string | null;
  site: ScoreboardSite;
  venue: string | null;
  shiftAreas: string[];
};

export type UserScoreboard = {
  scope: {
    key: string;
    label: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
  };
  summary: {
    eventsWorked: number;
    wins: number;
    losses: number;
    ties: number;
    games: number;
    winRate: number | null;
    matchingEventsWorked?: number;
  };
  bySport: ScoreboardBucket[];
  byOpponent: ScoreboardBucket[];
  bySite: ScoreboardBucket[];
  byVenue: ScoreboardBucket[];
  events: ScoreboardEvent[];
  eventCount: number;
  nextCursor: string | null;
  /** Additive fields; older deployed servers may omit them during rollout. */
  facets?: ScoreboardFacets;
  seasonGames?: number;
  recentResults?: ScoreboardEvent[];
  streak?: { result: ScoreboardResult; count: number } | null;
};

export type ScoreboardPage = {
  offset: number;
  limit: number;
};

const SITE_ORDER: Array<CalendarEventSite | null> = ["HOME", "AWAY", "NEUTRAL", null];

function bucketLabel(dimension: "sport" | "opponent" | "site" | "venue", key: string | null): string {
  if (dimension === "sport") return key ? sportLabel(key) : "Unknown sport";
  if (dimension === "opponent") return key ?? "Unknown opponent";
  if (dimension === "site") return siteLabel(key as CalendarEventSite | null);
  return key ?? "Unknown venue";
}

function addBucket(
  buckets: Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>,
  key: string | null,
  result: CalendarEventResult | null,
  count: number,
): void {
  const bucket = buckets.get(key) ?? { key, wins: 0, losses: 0, ties: 0 };
  if (result === "WIN") bucket.wins += count;
  if (result === "LOSS") bucket.losses += count;
  if (result === "TIE") bucket.ties += count;
  buckets.set(key, bucket);
}

function finishBuckets(
  buckets: Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>,
  dimension: "sport" | "opponent" | "site" | "venue",
): ScoreboardBucket[] {
  return [...buckets.values()]
    .map((bucket) => ({
      key: bucket.key,
      label: bucketLabel(dimension, bucket.key),
      wins: bucket.wins,
      losses: bucket.losses,
      ties: bucket.ties,
      games: bucket.wins + bucket.losses + bucket.ties,
      winRate: winRate(bucket.wins, bucket.losses, bucket.ties),
    }))
    .sort((a, b) => {
      if (dimension === "site") {
        return SITE_ORDER.indexOf(a.key as CalendarEventSite | null) - SITE_ORDER.indexOf(b.key as CalendarEventSite | null);
      }
      const gameDelta = b.games - a.games;
      if (gameDelta !== 0) return gameDelta;
      return a.label.localeCompare(b.label);
    });
}

export function getScoreboardScope(season: string | null | undefined) {
  if (!season || season === SCOREBOARD_SEASON_KEY) return SCOREBOARD_SCOPE;
  return null;
}

export async function getScoreboardForUser(
  userId: string,
  filters: ScoreboardFilters = {},
  page: ScoreboardPage = { offset: 0, limit: 25 },
): Promise<UserScoreboard> {
  // Two season-bounded scalar reads keep work history separate from official
  // results. No per-event crew graph or private assignment metadata is needed.
  const select = {
    id: true, summary: true, startsAt: true, allDay: true, result: true,
    sportCode: true, opponent: true, site: true, rawLocationText: true,
  } satisfies Prisma.CalendarEventSelect;
  const now = new Date();
  const [workedRows, recordRows] = await Promise.all([
    db.calendarEvent.findMany({
      where: { ...workedEventWhere(userId), endsAt: { lt: now } },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      select,
    }),
    db.calendarEvent.findMany({
      where: gameRecordEventWhere(userId, now),
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      select,
    }),
  ]);

  const officialResults = new Map(recordRows.map((row) => [row.id, row.result]));
  const allRows = [...new Map([...workedRows, ...recordRows].map((row) => [row.id, row])).values()]
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || b.id.localeCompare(a.id));
  const allEvents: ScoreboardEvent[] = allRows.map((event) => ({
    id: event.id,
    summary: event.summary,
    startsAt: event.startsAt.toISOString(),
    allDay: event.allDay,
    // Non-official outcomes stay on Schedule, never in Scoreboard form/streaks.
    result: (officialResults.get(event.id) ?? null) as ScoreboardResult | null,
    sportCode: event.sportCode,
    sportLabel: event.sportCode ? sportLabel(event.sportCode) : null,
    opponent: normalizeOpponentName(event.opponent),
    site: event.site,
    venue: scheduleVenueDisplayName(event.rawLocationText),
    shiftAreas: [],
  }));
  const filteredEvents = allEvents.filter((event) => (
    (!filters.sportCode || event.sportCode === filters.sportCode)
    && (!filters.result || event.result === filters.result)
    && (!filters.site || event.site === filters.site)
    && (!filters.venue || event.venue === filters.venue)
    && (!filters.opponent || event.opponent === filters.opponent)
  ));

  const bySport = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const byOpponent = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const bySite = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const byVenue = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const row of filteredEvents) {
    // Result-less worked events belong in the event list and work total, not
    // in the official W/L/T record or its dimensional breakdowns.
    if (row.result === null) continue;
    const count = 1;
    if (row.result === "WIN") wins += count;
    if (row.result === "LOSS") losses += count;
    if (row.result === "TIE") ties += count;

    addBucket(bySport, row.sportCode, row.result, count);
    addBucket(byOpponent, row.opponent, row.result, count);
    addBucket(bySite, row.site, row.result, count);
    addBucket(byVenue, row.venue, row.result, count);
  }

  const events = filteredEvents.slice(page.offset, page.offset + page.limit);
  const resolvedEvents = filteredEvents.filter((event) => event.result !== null);
  const firstResult = resolvedEvents[0]?.result;
  const streakEnd = resolvedEvents.findIndex((event) => event.result !== firstResult);
  const streakCount = streakEnd < 0 ? resolvedEvents.length : streakEnd;
  const facet = (key: "sportCode" | "venue" | "opponent"): ScoreboardFacet[] => (
    [...new Set(allEvents.map((event) => event[key]).filter((value): value is string => value !== null))]
      .map((value) => ({ key: value, label: key === "sportCode" ? sportLabel(value) : value }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  return {
    scope: {
      key: SCOREBOARD_SCOPE.key,
      label: SCOREBOARD_SCOPE.label,
      startsAt: SCOREBOARD_SCOPE.startsAt.toISOString(),
      endsAt: SCOREBOARD_SCOPE.endsAt.toISOString(),
      timeZone: SCOREBOARD_SCOPE.timeZone,
    },
    summary: {
      eventsWorked: workedRows.length,
      matchingEventsWorked: filteredEvents.length,
      wins, losses, ties, games: wins + losses + ties, winRate: winRate(wins, losses, ties),
    },
    bySport: finishBuckets(bySport, "sport"),
    byOpponent: finishBuckets(byOpponent, "opponent"),
    bySite: finishBuckets(bySite, "site"),
    byVenue: finishBuckets(byVenue, "venue"),
    events,
    eventCount: filteredEvents.length,
    nextCursor: page.offset + page.limit < filteredEvents.length ? String(page.offset + page.limit) : null,
    facets: { sports: facet("sportCode"), venues: facet("venue"), opponents: facet("opponent") },
    seasonGames: recordRows.length,
    recentResults: resolvedEvents.slice(0, 5),
    streak: firstResult && streakCount >= 2 ? { result: firstResult, count: streakCount } : null,
  };
}
