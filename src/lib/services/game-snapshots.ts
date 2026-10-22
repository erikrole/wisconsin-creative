import type { CalendarEventResult, Prisma, ShiftArea } from "@prisma/client";
import { db } from "@/lib/db";
import { scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { GAME_RECORD_END_DATE, GAME_RECORD_START_DATE } from "@/lib/services/game-record";

/**
 * Durable per-game history for Scoreboard replay and the December recap.
 *
 * Live rows are allowed to change after a game: a published slot is removed
 * (its assignment cascades away), an admin-added worker is deleted, a source is
 * deleted with all its events, a result is corrected, or the event is archived.
 * Audit logs that would explain those changes are pruned after 90 days. The
 * nightly capture keeps one snapshot per finished game so replay never depends
 * on any of that surviving.
 */

export const GAME_SNAPSHOT_SEASON_KEY = "2026-27";

/** Re-read games that ended recently so same-week crew and result fixes land. */
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Bounded per run; anything left over is picked up the next morning. */
const MAX_EVENTS_PER_RUN = 150;

const NON_OFFICIAL_MARKERS = ["exhibition", "scrimmage", "alumni match"];

export type GameSnapshotCrewMember = {
  userId: string;
  name: string;
  source: "assignment" | "worker";
  area: ShiftArea | null;
  crewLabel: string | null;
  attended: boolean | null;
  /** Set when the person is no longer on the live crew; cleared if they return. */
  leftAt: string | null;
};

export type GameSnapshotResultChange = {
  result: CalendarEventResult | null;
  at: string;
};

export function isOfficialGame(rawSummary: string | null): boolean {
  const lower = (rawSummary ?? "").toLowerCase();
  return !NON_OFFICIAL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Live crew wins for anyone present; anyone stored but now missing is kept with
 * `leftAt`, so a deleted shift or worker row never erases that they were there.
 */
export function mergeSnapshotCrew(
  stored: GameSnapshotCrewMember[],
  live: Omit<GameSnapshotCrewMember, "leftAt">[],
  now: Date,
): GameSnapshotCrewMember[] {
  const liveIds = new Set(live.map((member) => member.userId));
  const merged: GameSnapshotCrewMember[] = live.map((member) => ({ ...member, leftAt: null }));
  for (const member of stored) {
    if (liveIds.has(member.userId)) continue;
    merged.push({ ...member, leftAt: member.leftAt ?? now.toISOString() });
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/** Appends to the result history only when the result actually changed. */
export function nextResultHistory(
  history: GameSnapshotResultChange[],
  result: CalendarEventResult | null,
  now: Date,
): { history: GameSnapshotResultChange[]; changed: boolean } {
  const last = history.at(-1);
  if (last ? last.result === result : result === null) return { history, changed: false };
  return { history: [...history, { result, at: now.toISOString() }], changed: true };
}

export function liveCrew(event: CapturedEvent): Omit<GameSnapshotCrewMember, "leftAt">[] {
  const byUser = new Map<string, Omit<GameSnapshotCrewMember, "leftAt">>();
  for (const shift of event.shiftGroup?.shifts ?? []) {
    for (const assignment of shift.assignments) {
      if (byUser.has(assignment.user.id)) continue;
      byUser.set(assignment.user.id, {
        userId: assignment.user.id,
        name: assignment.user.name,
        source: "assignment",
        area: shift.area,
        crewLabel: assignment.crewLabel,
        attended: assignment.attended,
      });
    }
  }
  for (const worker of event.workers) {
    if (byUser.has(worker.user.id)) continue;
    byUser.set(worker.user.id, {
      userId: worker.user.id,
      name: worker.user.name,
      source: "worker",
      area: null,
      crewLabel: null,
      attended: null,
    });
  }
  return [...byUser.values()];
}

export const CAPTURE_SELECT = {
  id: true,
  summary: true,
  rawSummary: true,
  rawLocationText: true,
  startsAt: true,
  endsAt: true,
  status: true,
  result: true,
  sportCode: true,
  opponent: true,
  site: true,
  shiftGroup: {
    select: {
      shifts: {
        select: {
          area: true,
          assignments: {
            // Every person, active or not, hidden or not: visibility is a read
            // decision. Only the assignment's own state decides crew.
            where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
            select: {
              crewLabel: true,
              attended: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  workers: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.CalendarEventSelect;

export type CapturedEvent = Prisma.CalendarEventGetPayload<{ select: typeof CAPTURE_SELECT }>;

export type GameSnapshotRunResult = {
  captured: number;
  remaining: number;
  deletedMarked: number;
};

export async function captureGameSnapshots(
  now: Date = new Date(),
  options: { deadlineAt?: number } = {},
): Promise<GameSnapshotRunResult> {
  const seasonWhere: Prisma.CalendarEventWhereInput = {
    startsAt: { gte: GAME_RECORD_START_DATE, lt: GAME_RECORD_END_DATE },
    endsAt: { lt: now },
    isHidden: false,
    status: { not: "CANCELLED" },
    // Only games something happened at: a result, a schedule, or a worker.
    OR: [{ result: { not: null } }, { shiftGroup: { isNot: null } }, { workers: { some: {} } }],
  };

  const [finished, existing] = await Promise.all([
    db.calendarEvent.findMany({ where: seasonWhere, select: { id: true, endsAt: true } }),
    db.gameSnapshot.findMany({
      where: { seasonKey: GAME_SNAPSHOT_SEASON_KEY },
      select: { eventId: true, eventDeletedAt: true },
    }),
  ]);

  const snapshotIds = new Set(existing.map((row) => row.eventId));
  const recentCutoff = now.getTime() - RECENT_WINDOW_MS;
  // Missing snapshots first (the backfill), then the recent re-reads.
  const missing = finished.filter((event) => !snapshotIds.has(event.id)).map((event) => event.id);
  const recent = finished
    .filter((event) => snapshotIds.has(event.id) && event.endsAt.getTime() >= recentCutoff)
    .map((event) => event.id);
  const queue = [...missing, ...recent];
  const batch = queue.slice(0, MAX_EVENTS_PER_RUN);

  // A snapshot whose event row no longer exists keeps its history, flagged.
  const finishedIds = new Set(finished.map((event) => event.id));
  const possiblyDeleted = existing
    .filter((row) => !row.eventDeletedAt && !finishedIds.has(row.eventId))
    .map((row) => row.eventId);
  let deletedMarked = 0;
  if (possiblyDeleted.length > 0) {
    const stillThere = new Set(
      (await db.calendarEvent.findMany({ where: { id: { in: possiblyDeleted } }, select: { id: true } }))
        .map((row) => row.id),
    );
    const gone = possiblyDeleted.filter((id) => !stillThere.has(id));
    if (gone.length > 0) {
      deletedMarked = (await db.gameSnapshot.updateMany({
        where: { eventId: { in: gone } },
        data: { eventDeletedAt: now },
      })).count;
    }
  }

  if (batch.length === 0) return { captured: 0, remaining: 0, deletedMarked };

  const [events, stored] = await Promise.all([
    db.calendarEvent.findMany({ where: { id: { in: batch } }, select: CAPTURE_SELECT }),
    db.gameSnapshot.findMany({
      where: { eventId: { in: batch } },
      select: { eventId: true, crew: true, resultHistory: true, resultRecordedAt: true },
    }),
  ]);
  const storedById = new Map(stored.map((row) => [row.eventId, row]));

  let captured = 0;
  for (const event of events) {
    if (options.deadlineAt && Date.now() > options.deadlineAt) break;
    const previous = storedById.get(event.id);
    const crew = mergeSnapshotCrew(
      (previous?.crew as GameSnapshotCrewMember[] | undefined) ?? [],
      liveCrew(event),
      now,
    );
    const { history, changed } = nextResultHistory(
      (previous?.resultHistory as GameSnapshotResultChange[] | undefined) ?? [],
      event.result,
      now,
    );
    const data = {
      seasonKey: GAME_SNAPSHOT_SEASON_KEY,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      sportCode: event.sportCode,
      opponent: event.opponent,
      site: event.site,
      venue: scheduleVenueDisplayName(event.rawLocationText),
      title: event.summary,
      rawSummary: event.rawSummary,
      status: event.status,
      official: isOfficialGame(event.rawSummary),
      result: event.result,
      resultRecordedAt: changed ? now : previous?.resultRecordedAt ?? null,
      resultHistory: history as Prisma.InputJsonValue,
      crew: crew as unknown as Prisma.InputJsonValue,
      crewCount: crew.filter((member) => !member.leftAt).length,
      eventDeletedAt: null,
    };
    await db.gameSnapshot.upsert({
      where: { eventId: event.id },
      create: { eventId: event.id, ...data },
      update: data,
    });
    captured += 1;
  }

  return { captured, remaining: Math.max(0, queue.length - captured), deletedMarked };
}
