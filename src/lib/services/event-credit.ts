import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";

/**
 * Scoreboard-only participation.
 *
 * A credit says "this person worked this event" for stats purposes and nothing
 * else. It creates no shift, no assignment, no notification, and no schedule
 * entry, so a credited person never sees the event on My Shifts, in a published
 * crew, in a trade, or in their ICS feed. Admins own the write path; the read
 * path is every place that already counts an active assignment.
 */

/** One person on one event, however that participation was recorded. */
export type EventParticipant = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type EventCreditRow = {
  id: string;
  note: string | null;
  createdAt: string;
  user: EventParticipant & { role: string; active: boolean };
  createdBy: { id: string; name: string } | null;
  alsoAssigned: boolean;
};

export const EVENT_CREDIT_NOTE_MAX = 200;

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
 * Events this person is credited for: an active assignment or an admin-recorded
 * credit. Spread into an existing `where` — callers own the season bounds,
 * status, and visibility rules, and none of them set `OR` themselves.
 */
export function participatedEventWhere(userId: string): Prisma.CalendarEventWhereInput {
  return {
    OR: [assignedWhere(userId), { credits: { some: { userId } } }],
  };
}

/**
 * The same predicate without naming a person: an event counts as covered when
 * at least one visible active person is assigned or credited. `userWhere` is the
 * caller's visibility rule for that person.
 */
export function participatedByAnyoneWhere(
  userWhere: Prisma.UserWhereInput,
  assignmentWhere: Prisma.ShiftAssignmentWhereInput,
): Prisma.CalendarEventWhereInput {
  return {
    OR: [
      { shiftGroup: { shifts: { some: { assignments: { some: assignmentWhere } } } } },
      { credits: { some: { user: userWhere } } },
    ],
  };
}

const CREDIT_ROW_SELECT = {
  id: true,
  note: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true, role: true, active: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.EventCreditSelect;

/**
 * Credits on one event, oldest first, flagged where the person also holds a
 * real assignment. That flag is the admin's signal that a credit is redundant:
 * the Scoreboard counts the person once either way.
 */
export async function listEventCredits(eventId: string): Promise<EventCreditRow[]> {
  const [credits, shiftGroup] = await Promise.all([
    db.eventCredit.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: CREDIT_ROW_SELECT,
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

  return credits.map((credit) => ({
    id: credit.id,
    note: credit.note,
    createdAt: credit.createdAt.toISOString(),
    user: credit.user,
    createdBy: credit.createdBy,
    alsoAssigned: assignedIds.has(credit.user.id),
  }));
}
