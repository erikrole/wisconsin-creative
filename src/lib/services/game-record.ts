import { db } from "@/lib/db";
import { startOfDayInAppTz } from "@/lib/app-time";
import { participatedEventWhere } from "@/lib/services/event-worker";
import type { CalendarEventSite, Prisma } from "@prisma/client";

/** Wins, losses, and ties over some slice of games. */
export type WinLoss = {
  wins: number;
  losses: number;
  ties: number;
};

/** W-L-T totals plus the dimensions worth counting them by. */
export type GameRecord = WinLoss & {
  /** Count of completed 2026–27 Schedule events with an active assignment. */
  eventsWorked: number;
  bySport: Array<WinLoss & { sportCode: string | null }>;
  bySite: Array<WinLoss & { site: CalendarEventSite | null }>;
};

export const EMPTY_GAME_RECORD: GameRecord = { eventsWorked: 0, wins: 0, losses: 0, ties: 0, bySport: [], bySite: [] };

/**
 * Profile records start with the 2026-27 operating season. Resolve the fixed
 * calendar date through the app timezone so "July 1" means the local day
 * boundary rather than UTC midnight.
 */
export const GAME_RECORD_START_DATE = startOfDayInAppTz(new Date("2026-07-01T12:00:00.000Z"));
export const GAME_RECORD_END_DATE = startOfDayInAppTz(new Date("2027-07-01T12:00:00.000Z"));

export type WorkedEventBounds = {
  startsAt: Date;
  endsAt: Date;
};

export const WORKED_EVENT_SCOPE: WorkedEventBounds = {
  startsAt: GAME_RECORD_START_DATE,
  endsAt: GAME_RECORD_END_DATE,
};

/** Fixed display order; `null` is unknown and sorts last. */
const SITE_ORDER: Array<CalendarEventSite | null> = ["HOME", "AWAY", "NEUTRAL", null];

/**
 * Source titles that describe non-official competition. The raw result stays
 * on CalendarEvent as schedule history, but these rows are not part of an
 * official staff win-loss-tie record.
 */
export const OFFICIAL_RECORD_EVENT_EXCLUSION: Prisma.CalendarEventWhereInput = {
  NOT: [
    { rawSummary: { contains: "exhibition", mode: "insensitive" } },
    { rawSummary: { contains: "scrimmage", mode: "insensitive" } },
    { rawSummary: { contains: "alumni match", mode: "insensitive" } },
  ],
};

/**
 * Completed Schedule events credited to a person for recap and recognition
 * totals. This intentionally does not require an outcome or opponent, and it
 * keeps archived history while excluding hidden/test rows and cancelled or
 * future assignments. Workers an admin added outside the schedule count here
 * exactly like an active assignment.
 */
export function workedEventWhere(
  userId: string,
  bounds: WorkedEventBounds = WORKED_EVENT_SCOPE,
): Prisma.CalendarEventWhereInput {
  return {
    startsAt: { gte: bounds.startsAt, lt: bounds.endsAt },
    endsAt: { lt: new Date() },
    status: "CONFIRMED",
    isHidden: false,
    ...participatedEventWhere(userId),
  };
}

export async function getWorkedEventCountForUser(
  userId: string,
  bounds: WorkedEventBounds = WORKED_EVENT_SCOPE,
): Promise<number> {
  return db.calendarEvent.count({ where: workedEventWhere(userId, bounds) });
}

/**
 * Games that count toward a record: a real, visible event on or after the
 * profile-record start date that carries a source-derived outcome (win, loss,
 * or tie). Mirrors
 * `buildScheduleEventWhere`'s definition of a countable event so a profile
 * record never disagrees with the schedule's event visibility rules.
 * Exhibition, scrimmage, and alumni-match rows remain schedule history but
 * are not official record games. Workers an admin added outside the schedule
 * count here exactly like an active assignment.
 */
export function gameRecordEventWhere(userId: string): Prisma.CalendarEventWhereInput {
  return {
    ...OFFICIAL_RECORD_EVENT_EXCLUSION,
    result: { not: null },
    startsAt: { gte: GAME_RECORD_START_DATE },
    status: { not: "CANCELLED" },
    isHidden: false,
    archivedAt: null,
    ...participatedEventWhere(userId),
  };
}

function addTo<T extends WinLoss>(bucket: T, result: string | null, count: number): void {
  if (result === "WIN") bucket.wins += count;
  else if (result === "LOSS") bucket.losses += count;
  else if (result === "TIE") bucket.ties += count;
}

/**
 * Tally wins, losses, and ties across every game the user held a shift assignment on,
 * broken down by sport and by where the game was played.
 *
 * Grouped by event rather than by assignment: a user working two shifts on one
 * game is one game, not two, and being added to a game they were also assigned
 * to adds nothing. Declined and swapped-away assignments are not
 * assignments, so they are excluded via `ACTIVE_ASSIGNMENT_STATUSES`. Site
 * comes from `site`, not `isHome`, so a neutral game is counted as neutral
 * rather than lumped in with games we could not classify.
 */
export async function getGameRecordForUser(userId: string): Promise<GameRecord> {
  const [grouped, eventsWorked] = await Promise.all([
    db.calendarEvent.groupBy({
      by: ["result", "sportCode", "site"],
      where: gameRecordEventWhere(userId),
      _count: { _all: true },
    }),
    getWorkedEventCountForUser(userId),
  ]);

  const record: GameRecord = { eventsWorked, wins: 0, losses: 0, ties: 0, bySport: [], bySite: [] };
  const sports = new Map<string | null, WinLoss & { sportCode: string | null }>();
  const sites = new Map<CalendarEventSite | null, WinLoss & { site: CalendarEventSite | null }>();

  for (const row of grouped) {
    const count = row._count._all;
    addTo(record, row.result, count);

    const sport = sports.get(row.sportCode) ?? { sportCode: row.sportCode, wins: 0, losses: 0, ties: 0 };
    addTo(sport, row.result, count);
    sports.set(row.sportCode, sport);

    const site = sites.get(row.site) ?? { site: row.site, wins: 0, losses: 0, ties: 0 };
    addTo(site, row.result, count);
    sites.set(row.site, site);
  }

  record.bySport = [...sports.values()].sort((a, b) => {
    const played = b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties);
    if (played !== 0) return played;
    return (a.sportCode ?? "￿").localeCompare(b.sportCode ?? "￿");
  });
  record.bySite = [...sites.values()].sort(
    (a, b) => SITE_ORDER.indexOf(a.site) - SITE_ORDER.indexOf(b.site),
  );

  return record;
}
