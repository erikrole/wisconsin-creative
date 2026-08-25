import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";

/**
 * Workers recorded outside the schedule.
 *
 * Adding a worker says "this person worked this event" for stats purposes and
 * nothing else. It creates no shift, no assignment, no notification, and no
 * schedule entry, so an added worker never sees the event on My Shifts, in a
 * published crew, in a trade, or in their ICS feed. Admins own the write path;
 * the read path is every place that already counts an active assignment.
 */

/** One person on one event, however that participation was recorded. */
export type EventParticipant = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type EventWorkerRow = {
  id: string;
  note: string | null;
  createdAt: string;
  user: EventParticipant & { role: string; active: boolean };
  addedBy: { id: string; name: string } | null;
  alsoAssigned: boolean;
};

export const EVENT_WORKER_NOTE_MAX = 200;

/** An active, non-terminal shift assignment for this person on this event. */
function assignedWhere(userId: string): Prisma.CalendarEventWhereInput {
  return {
    shiftGroup: {
      shifts: {
        some: {
          assignments: {
            some: { userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
          },
        },
      },
    },
  };
}

/**
 * Events this person is on record as having worked: an active assignment or an
 * admin-added worker row. Spread into an existing `where` — callers own the
 * season bounds, status, and visibility rules, and none of them set `OR`
 * themselves.
 */
export function participatedEventWhere(userId: string): Prisma.CalendarEventWhereInput {
  return {
    OR: [assignedWhere(userId), { workers: { some: { userId } } }],
  };
}

/**
 * The same predicate without naming a person: an event counts as covered when
 * at least one visible active person is assigned or added. `userWhere` is the
 * caller's visibility rule for that person.
 */
export function participatedByAnyoneWhere(
  userWhere: Prisma.UserWhereInput,
  assignmentWhere: Prisma.ShiftAssignmentWhereInput,
): Prisma.CalendarEventWhereInput {
  return {
    OR: [
      { shiftGroup: { shifts: { some: { assignments: { some: assignmentWhere } } } } },
      { workers: { some: { user: userWhere } } },
    ],
  };
}

const WORKER_ROW_SELECT = {
  id: true,
  note: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true, role: true, active: true } },
  addedBy: { select: { id: true, name: true } },
} satisfies Prisma.EventWorkerSelect;

/**
 * Added workers on one event, oldest first, flagged where the person also holds
 * a real assignment. That flag is the admin's signal that the row is redundant:
 * the Scoreboard counts the person once either way.
 */
export async function listEventWorkers(eventId: string): Promise<EventWorkerRow[]> {
  const [workers, shiftGroup] = await Promise.all([
    db.eventWorker.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: WORKER_ROW_SELECT,
    }),
    db.shiftGroup.findFirst({
      where: { eventId },
      select: {
        shifts: {
          select: {
            assignments: {
              where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
              select: { userId: true },
            },
          },
        },
      },
    }),
  ]);

  const assignedIds = new Set(
    shiftGroup?.shifts.flatMap((shift) => shift.assignments.map((a) => a.userId)) ?? [],
  );

  return workers.map((worker) => ({
    id: worker.id,
    note: worker.note,
    createdAt: worker.createdAt.toISOString(),
    user: worker.user,
    addedBy: worker.addedBy,
    alsoAssigned: assignedIds.has(worker.user.id),
  }));
}
