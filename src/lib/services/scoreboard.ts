import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sportLabel } from "@/lib/sports";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { participatedEventWhere } from "@/lib/services/event-worker";
import { scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import { AREAS } from "@/types/areas";
import {
  GAME_RECORD_END_DATE,
  GAME_RECORD_START_DATE,
  getWorkedEventCountForUser,
  OFFICIAL_RECORD_EVENT_EXCLUSION,
  type WorkedEventBounds,
} from "@/lib/services/game-record";
import type { CalendarEventResult, CalendarEventSite, Prisma } from "@prisma/client";

export const SCOREBOARD_SEASON_KEY = "2026-27";
export const SCOREBOARD_SCOPE = {
  key: SCOREBOARD_SEASON_KEY,
  label: "Current season",
  startsAt: GAME_RECORD_START_DATE,
  endsAt: GAME_RECORD_END_DATE,
  timeZone: env.appTimezone,
} as const;

export type ScoreboardResult = Extract<CalendarEventResult, "WIN" | "LOSS" | "TIE">;
export type ScoreboardSite = CalendarEventSite | null;

export type ScoreboardFilters = {
  sportCode?: string;
  result?: ScoreboardResult;
  site?: CalendarEventSite;
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
  };
  bySport: ScoreboardBucket[];
  byOpponent: ScoreboardBucket[];
  bySite: ScoreboardBucket[];
  byVenue: ScoreboardBucket[];
  events: ScoreboardEvent[];
  eventCount: number;
  nextCursor: string | null;
};

export type ScoreboardPage = {
  offset: number;
  limit: number;
};

const SITE_LABELS: Record<Exclude<CalendarEventSite, never>, string> = {
  HOME: "Home",
  AWAY: "Away",
  NEUTRAL: "Neutral",
};

const SITE_ORDER: Array<CalendarEventSite | null> = ["HOME", "AWAY", "NEUTRAL", null];
const SHIFT_AREA_ORDER = new Map<string, number>(AREAS.map((area, index) => [area, index]));

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function orderedUniqueShiftAreas(areas: string[]): string[] {
  return [...new Set(areas)].sort((a, b) => {
    const orderDelta = (SHIFT_AREA_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER)
      - (SHIFT_AREA_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER);
    return orderDelta || a.localeCompare(b);
  });
}

function siteLabel(site: CalendarEventSite | null): string {
  return site ? SITE_LABELS[site] : "Unknown site";
}

function winRate(wins: number, losses: number, ties: number): number | null {
  const games = wins + losses + ties;
  if (games === 0) return null;
  // A tie counts as half a win, matching the conventional winning percentage
  // while keeping the displayed record itself as W-L-T when ties exist.
  return Math.round(((wins + ties / 2) / games) * 1000) / 10;
}

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

export function scoreboardEventWhere(
  userId: string,
  filters: ScoreboardFilters = {},
): Prisma.CalendarEventWhereInput {
  const where: Prisma.CalendarEventWhereInput = {
    ...OFFICIAL_RECORD_EVENT_EXCLUSION,
    ...(filters.result ? { result: filters.result } : {}),
    startsAt: { gte: SCOREBOARD_SCOPE.startsAt, lt: SCOREBOARD_SCOPE.endsAt },
    endsAt: { lt: new Date() },
    status: { not: "CANCELLED" },
    isHidden: false,
    archivedAt: null,
    // An active assignment or a worker an admin added outside the schedule; a
    // person holding both on one event is still one event.
    ...participatedEventWhere(userId),
  };

  if (filters.sportCode) where.sportCode = filters.sportCode;
  // Home, away, and neutral are already a breakdown row here. Filtering by one
  // is the question that row invites -- "how do I do on the road" -- and it
  // narrows the record, the breakdowns, and the game list together, exactly as
  // sport and result do.
  if (filters.site) where.site = filters.site;
  return where;
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
  const where = scoreboardEventWhere(userId, filters);
  const eventBounds: WorkedEventBounds = {
    startsAt: SCOREBOARD_SCOPE.startsAt,
    endsAt: SCOREBOARD_SCOPE.endsAt,
  };
  const [grouped, eventRows, eventCount, eventsWorked] = await Promise.all([
    db.calendarEvent.groupBy({
      by: ["result", "sportCode", "site", "opponent", "rawLocationText"],
      where,
      _count: { _all: true },
    }),
    db.calendarEvent.findMany({
      where,
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      skip: page.offset,
      take: page.limit + 1,
      select: {
        id: true,
        summary: true,
        startsAt: true,
        allDay: true,
        result: true,
        sportCode: true,
        opponent: true,
        site: true,
        rawLocationText: true,
        shiftGroup: {
          select: {
            shifts: {
              where: {
                assignments: {
                  some: { userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
                },
              },
              select: { area: true },
            },
          },
        },
      },
    }),
    db.calendarEvent.count({ where }),
    getWorkedEventCountForUser(userId, eventBounds),
  ]);

  const bySport = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const byOpponent = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const bySite = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  const byVenue = new Map<string | null, { key: string | null; wins: number; losses: number; ties: number }>();
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const row of grouped) {
    // Result-less worked events belong in the event list and work total, not
    // in the official W/L/T record or its dimensional breakdowns.
    if (row.result === null) continue;
    const count = row._count._all;
    if (row.result === "WIN") wins += count;
    if (row.result === "LOSS") losses += count;
    if (row.result === "TIE") ties += count;

    addBucket(bySport, row.sportCode, row.result, count);
    addBucket(byOpponent, trimmedOrNull(row.opponent), row.result, count);
    addBucket(bySite, row.site, row.result, count);
    addBucket(byVenue, scheduleVenueDisplayName(row.rawLocationText), row.result, count);
  }

  const hasMore = eventRows.length > page.limit;
  const events = eventRows.slice(0, page.limit).map((event): ScoreboardEvent => ({
    id: event.id,
    summary: event.summary,
    startsAt: event.startsAt.toISOString(),
    allDay: event.allDay,
    result: event.result as ScoreboardResult | null,
    sportCode: event.sportCode,
    sportLabel: event.sportCode ? sportLabel(event.sportCode) : null,
    opponent: trimmedOrNull(event.opponent),
    site: event.site,
    venue: scheduleVenueDisplayName(event.rawLocationText),
    shiftAreas: orderedUniqueShiftAreas(event.shiftGroup?.shifts.map((shift) => shift.area) ?? []),
  }));

  return {
    scope: {
      key: SCOREBOARD_SCOPE.key,
      label: SCOREBOARD_SCOPE.label,
      startsAt: SCOREBOARD_SCOPE.startsAt.toISOString(),
      endsAt: SCOREBOARD_SCOPE.endsAt.toISOString(),
      timeZone: SCOREBOARD_SCOPE.timeZone,
    },
    summary: { eventsWorked, wins, losses, ties, games: wins + losses + ties, winRate: winRate(wins, losses, ties) },
    bySport: finishBuckets(bySport, "sport"),
    byOpponent: finishBuckets(byOpponent, "opponent"),
    bySite: finishBuckets(bySite, "site"),
    byVenue: finishBuckets(byVenue, "venue"),
    events,
    eventCount,
    nextCursor: hasMore ? String(page.offset + page.limit) : null,
  };
}
