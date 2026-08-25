import type { Prisma, ShiftAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { normalizeStoredSnapshot } from "@/lib/schedule-publication-types";
import { buildSchedulePublicationSnapshot } from "@/lib/services/schedule-publication";
import {
  affectedUserIds,
  diffScheduleForNotification,
} from "@/lib/services/schedule-notification-diff";
import { notifyScheduleChanges } from "@/lib/services/notifications";

export type ScheduleFlushOutcome =
  | { status: "delivered"; shiftGroupId: string; userIds: string[]; version: number }
  | { status: "nothing_to_tell"; shiftGroupId: string }
  | { status: "deferred"; shiftGroupId: string; notifyAfter: Date }
  | { status: "missing"; shiftGroupId: string }
  | { status: "event_ended"; shiftGroupId: string }
  | { status: "failed"; shiftGroupId: string; error: string };

const flushGroupSelect = {
  id: true,
  publishedAt: true,
  publishedVersion: true,
  lastPublishedSnapshot: true,
  notifyAfter: true,
  event: { select: { id: true, summary: true, endsAt: true } },
  shifts: {
    select: {
      id: true,
      area: true,
      workerType: true,
      startsAt: true,
      endsAt: true,
      callStartsAt: true,
      callEndsAt: true,
      assignments: {
        where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES as ShiftAssignmentStatus[] } },
        select: {
          id: true,
          userId: true,
          status: true,
          callStartsAt: true,
          callEndsAt: true,
          callNote: true,
        },
      },
    },
  },
} satisfies Prisma.ShiftGroupSelect;

/**
 * Tell everyone whose schedule actually changed, then move the high-water mark.
 *
 * `lastPublishedSnapshot` records what workers have been told, not what staff
 * have edited, which is what lets the quiet period absorb churn. It advances
 * only after a delivery attempt that did not throw: a failed flush leaves the
 * mark where it was so the next one picks up the whole backlog rather than
 * silently dropping the changes nobody heard about.
 */
export async function flushScheduleNotifications(
  shiftGroupId: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<ScheduleFlushOutcome> {
  const now = options.now ?? new Date();
  const group = await db.shiftGroup.findUnique({
    where: { id: shiftGroupId },
    select: flushGroupSelect,
  });
  if (!group) return { status: "missing", shiftGroupId };

  // A later edit pushed the quiet period out; the run it started owns this.
  if (!options.force && group.notifyAfter && group.notifyAfter.getTime() > now.getTime()) {
    return { status: "deferred", shiftGroupId, notifyAfter: group.notifyAfter };
  }

  const current = buildSchedulePublicationSnapshot(group);

  /**
   * An event that has already finished has nothing left to tell anyone.
   *
   * Crew records get corrected after the fact -- a late fill-in, a bad slot
   * cleaned up -- and each edit restarts the quiet period. Without this, that
   * housekeeping pages the crew about a game they worked last week. The pending
   * release is cleared and the high-water mark advanced so the edit is recorded
   * as seen rather than left to resurface, but nothing is delivered and no
   * publication version is claimed for a release that never happened.
   */
  if (group.event.endsAt.getTime() <= now.getTime()) {
    await db.shiftGroup.update({
      where: { id: shiftGroupId },
      data: {
        lastPublishedSnapshot: current as unknown as Prisma.InputJsonValue,
        notifyAfter: null,
        notifyAttemptedAt: now,
        notifyError: null,
      },
    });
    return { status: "event_ended", shiftGroupId };
  }

  const previous = normalizeStoredSnapshot(group.lastPublishedSnapshot);
  const diff = diffScheduleForNotification(previous, current);

  const advance = async (data: Prisma.ShiftGroupUpdateInput = {}) => {
    await db.shiftGroup.update({
      where: { id: shiftGroupId },
      data: {
        lastPublishedSnapshot: current as unknown as Prisma.InputJsonValue,
        publishedVersion: { increment: 1 },
        publishedAt: group.publishedAt ?? now,
        notifyAfter: null,
        notifyAttemptedAt: now,
        notifyError: null,
        ...data,
      },
    });
  };

  if (!diff.changed) {
    // Nothing worker-visible moved, but the mark still advances so the next
    // flush compares against what is actually on the schedule now.
    await advance();
    return { status: "nothing_to_tell", shiftGroupId };
  }

  const version = group.publishedVersion + 1;

  try {
    await notifyScheduleChanges({
      shiftGroupId,
      eventId: group.event.id,
      eventTitle: group.event.summary,
      flushVersion: version,
      byUser: diff.byUser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.shiftGroup.update({
      where: { id: shiftGroupId },
      data: { notifyAttemptedAt: now, notifyError: message },
    });
    console.error("[Schedule] notification flush failed", { shiftGroupId, error });
    return { status: "failed", shiftGroupId, error: message };
  }

  await advance();
  return { status: "delivered", shiftGroupId, userIds: affectedUserIds(diff), version };
}

/**
 * Deliver flushes whose timer never fired.
 *
 * A lost workflow run, a deploy in the wrong second, or a failed attempt all
 * leave `notify_after` in the past with nobody coming back for it. Without this
 * the change stays live and silent, which is the failure the old model could
 * not recover from at all.
 */
export async function sweepDueScheduleNotifications(
  options: { now?: Date; limit?: number } = {},
): Promise<ScheduleFlushOutcome[]> {
  const now = options.now ?? new Date();
  const due = await db.shiftGroup.findMany({
    where: { notifyAfter: { not: null, lte: now } },
    select: { id: true },
    orderBy: { notifyAfter: "asc" },
    take: options.limit ?? 50,
  });

  const outcomes: ScheduleFlushOutcome[] = [];
  for (const group of due) {
    outcomes.push(await flushScheduleNotifications(group.id, { now }));
  }
  return outcomes;
}
