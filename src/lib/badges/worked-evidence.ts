import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import type { ShiftBadgeEvidence } from "./automatic-rules";

/**
 * The evidence behind shift recognition: every event this person is on record
 * as having worked, whether the record is a schedule assignment or a worker an
 * admin added outside the schedule (D-057).
 *
 * Both the progress reader and the awarding evaluator read through here so the
 * bar shown on a profile and the badge actually granted can never be computed
 * from two different definitions of "worked".
 */

/** How a worked event came to be on record. */
export type WorkedEvidenceSource = "ASSIGNMENT" | "ADDED";

/**
 * Shift evidence that remembers where it came from, so recognition can tell
 * work the schedule recorded from work an admin recorded after the fact.
 */
export type WorkedShiftEvidence = ShiftBadgeEvidence & { source: WorkedEvidenceSource };

type EvidenceClient = Pick<typeof db, "shiftAssignment" | "eventWorker"> | Prisma.TransactionClient;

const ASSIGNMENT_SELECT = {
  hasConflict: true,
  callStartsAt: true,
  callEndsAt: true,
  shift: {
    select: {
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      area: true,
      shiftGroup: {
        select: {
          event: {
            select: {
              id: true,
              isHome: true,
              sportCode: true,
              result: true,
              site: true,
              locationId: true,
              opponent: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ShiftAssignmentSelect;

const WORKER_SELECT = {
  event: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      isHome: true,
      sportCode: true,
      result: true,
      site: true,
      locationId: true,
      opponent: true,
    },
  },
} satisfies Prisma.EventWorkerSelect;

type WorkerRow = Prisma.EventWorkerGetPayload<{ select: typeof WORKER_SELECT }>;

/** An event that has already finished and was not cancelled. */
function endedEventWhere(now: Date) {
  return { endsAt: { lt: now }, status: "CONFIRMED" as const };
}

/**
 * Local noon on an all-day event's calendar date.
 *
 * All-day rows store a *date* at UTC midnight, so reading their hours as a work
 * window is meaningless — and reading them in local time would shift the date
 * backwards across the UTC boundary. Noon lands unambiguously inside the right
 * local day, which is the only fact an all-day event actually carries.
 */
function allDayAnchor(instant: Date, timeZone: string): Date {
  const noonUtc = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
    12,
  );
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(new Date(noonUtc));
  const drift = (Number(local) - 12) * 60 * 60 * 1000;
  return new Date(noonUtc - drift);
}

/**
 * An added worker rendered as shift evidence.
 *
 * The work window comes from the event itself, because that is what the person
 * was there for; an added worker carries no call times and no area, and both
 * stay empty rather than being invented. `hoursKnown: false` on an all-day event
 * keeps it out of the early-start and late-finish rules, which an all-day row's
 * midnight boundaries would otherwise trip for reasons that have nothing to do
 * with when anybody worked.
 */
function addedWorkerEvidence(worker: WorkerRow, timeZone: string): WorkedShiftEvidence {
  const { event } = worker;
  const startsAt = event.allDay ? allDayAnchor(event.startsAt, timeZone) : event.startsAt;
  const endsAt = event.allDay ? startsAt : event.endsAt;

  return {
    source: "ADDED",
    callStartsAt: null,
    callEndsAt: null,
    hasConflict: false,
    hoursKnown: !event.allDay,
    shift: {
      startsAt,
      endsAt,
      callStartsAt: null,
      callEndsAt: null,
      // An added worker row does not say which area the person covered, and
      // guessing one would inflate the area-breadth rules.
      area: "",
      shiftGroup: { event },
    },
  };
}

/**
 * Assignments and added workers for finished events, with added workers
 * deduplicated against assignments by event.
 *
 * A person already assigned to an event earns nothing extra from being added to
 * it — the row is a record of the same work, not a second shift.
 */
export async function loadWorkedShiftEvidence(
  client: EvidenceClient,
  userId: string,
  now: Date = new Date(),
  timeZone: string = env.appTimezone,
): Promise<WorkedShiftEvidence[]> {
  const [assignments, workers] = await Promise.all([
    client.shiftAssignment.findMany({
      where: {
        userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        shift: { shiftGroup: { event: endedEventWhere(now) } },
      },
      select: ASSIGNMENT_SELECT,
    }),
    client.eventWorker.findMany({
      where: { userId, event: endedEventWhere(now) },
      select: WORKER_SELECT,
    }),
  ]);

  const assignedEventIds = new Set(
    assignments.map((assignment) => assignment.shift.shiftGroup.event.id),
  );

  return [
    ...assignments.map((assignment): WorkedShiftEvidence => ({ ...assignment, source: "ASSIGNMENT" })),
    ...workers
      .filter((worker) => !assignedEventIds.has(worker.event.id))
      .map((worker) => addedWorkerEvidence(worker, timeZone)),
  ];
}

/** Users whose worked record changed recently enough to re-evaluate. */
export type RecentlyWorkedEventUser = {
  userId: string;
  hasAddedWorker: boolean;
  hasBackfilledAssignment: boolean;
};

export async function recentlyWorkedEventUsers(
  since: Date,
  now: Date = new Date(),
): Promise<RecentlyWorkedEventUser[]> {
  const window = { endsAt: { lt: now, gte: since }, status: "CONFIRMED" as const };
  const [assigned, added] = await Promise.all([
    db.shiftAssignment.findMany({
      where: {
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        shift: { shiftGroup: { event: window } },
      },
      select: {
        userId: true,
        createdAt: true,
        shift: {
          select: {
            shiftGroup: {
              select: { event: { select: { endsAt: true } } },
            },
          },
        },
      },
    }),
    db.eventWorker.findMany({
      where: { event: window },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const users = new Map<string, RecentlyWorkedEventUser>();
  for (const row of assigned) {
    const existing = users.get(row.userId);
    const hasBackfilledAssignment = row.createdAt instanceof Date
      && row.shift?.shiftGroup?.event?.endsAt instanceof Date
      && row.createdAt.getTime() > row.shift.shiftGroup.event.endsAt.getTime();
    users.set(row.userId, {
      userId: row.userId,
      hasAddedWorker: existing?.hasAddedWorker ?? false,
      hasBackfilledAssignment: Boolean(existing?.hasBackfilledAssignment || hasBackfilledAssignment),
    });
  }
  for (const row of added) {
    const existing = users.get(row.userId);
    users.set(row.userId, {
      userId: row.userId,
      hasAddedWorker: true,
      hasBackfilledAssignment: existing?.hasBackfilledAssignment ?? false,
    });
  }
  return [...users.values()];
}

/** Backward-compatible user-id projection for callers that only need counts. */
export async function usersWithRecentlyWorkedEvents(
  since: Date,
  now: Date = new Date(),
): Promise<string[]> {
  return (await recentlyWorkedEventUsers(since, now)).map(({ userId }) => userId);
}
