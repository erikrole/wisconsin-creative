// Shared plumbing for the shift trade services: effective windows, response
// shapes, notification buffering, and post-commit side effects.

import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { sendShiftTradeEmail, type ShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { sendPushToUser } from "@/lib/services/notifications";
import type { NotificationCategory } from "@/lib/notification-catalog";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

export function assertShiftNotStarted(startsAt: Date) {
  if (startsAt <= new Date()) {
    throw new HttpError(400, "This shift has already started");
  }
}

export function effectiveAssignmentWindow(assignment: {
  callStartsAt?: Date | null;
  callEndsAt?: Date | null;
  shift: {
    startsAt: Date;
    endsAt: Date;
    callStartsAt?: Date | null;
    callEndsAt?: Date | null;
  };
}) {
  return {
    startsAt: assignment.callStartsAt ?? assignment.shift.callStartsAt ?? assignment.shift.startsAt,
    endsAt: assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt,
  };
}

export function futureEffectiveAssignmentWhere(now: Date): Prisma.ShiftAssignmentWhereInput {
  return {
    OR: [
      { callStartsAt: { gt: now } },
      { callStartsAt: null, shift: { callStartsAt: { gt: now } } },
      { callStartsAt: null, shift: { callStartsAt: null, startsAt: { gt: now } } },
    ],
  };
}

export function staleEffectiveAssignmentWhere(now: Date): Prisma.ShiftAssignmentWhereInput {
  return {
    OR: [
      { callStartsAt: { lt: now } },
      { callStartsAt: null, shift: { callStartsAt: { lt: now } } },
      { callStartsAt: null, shift: { callStartsAt: null, startsAt: { lt: now } } },
    ],
  };
}

/**
 * The relation shape every trade mutation returns. Clients decode all trade
 * responses into one model that requires `postedBy` and the assignment's shift,
 * so a bare row reads as "Unexpected response".
 */
export const tradeResponseInclude = {
  shiftAssignment: {
    include: {
      shift: {
        include: { shiftGroup: { include: { event: true } } },
      },
      user: { select: { id: true, name: true } },
    },
  },
  postedBy: { select: { id: true, name: true } },
  claimedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShiftTradeInclude;

/** Event fields that decide whether a trade on it can still move. */
export const tradeEventStateSelect = {
  status: true,
  archivedAt: true,
  isHidden: true,
} satisfies Prisma.CalendarEventSelect;

/**
 * Mirrors the open-work board filter: a cancelled, archived, or hidden event
 * (or an archived crew) no longer has a shift anyone should claim or take over.
 */
export const liveTradeEventWhere = {
  shiftAssignment: {
    shift: {
      shiftGroup: {
        archivedAt: null,
        event: { isHidden: false, archivedAt: null, status: { not: "CANCELLED" } },
      },
    },
  },
} satisfies Prisma.ShiftTradeWhereInput;

export function assertTradeEventLive(shiftGroup: {
  archivedAt?: Date | null;
  event?: { status?: string | null; archivedAt?: Date | null; isHidden?: boolean | null } | null;
} | null | undefined) {
  const event = shiftGroup?.event;
  if (event?.status === "CANCELLED") {
    throw new HttpError(409, "This event was cancelled, so its shift can't be traded");
  }
  if (shiftGroup?.archivedAt || event?.archivedAt || event?.isHidden) {
    throw new HttpError(409, "This event is no longer on the schedule, so its shift can't be traded");
  }
}

export const availabilityBlockSelect = {
  kind: true,
  intent: true,
  status: true,
  dayOfWeek: true,
  date: true,
  dateEndsOn: true,
  allDay: true,
  startsAt: true,
  endsAt: true,
  label: true,
  semesterLabel: true,
  semesterStartsOn: true,
  semesterEndsOn: true,
} satisfies Prisma.StudentAvailabilityBlockSelect;

/* ── In-app notification helper ─────────────────────────────────────── */

export type NotificationWriter = Pick<Prisma.TransactionClient, "notification">;

/**
 * Writes one inbox row and reports whether it is new. `skipDuplicates` turns a
 * repeated dedupe key into a no-op instead of a unique violation, which inside
 * a transaction would abort the whole trade mutation. Returns the new row's
 * id, or null for a duplicate; callers only push or email for a new row, so a
 * retry never re-sends.
 */
export async function writeTradeNotification(
  client: NotificationWriter,
  userId: string,
  type: string,
  title: string,
  body: string,
  dedupeKey: string,
  payload?: Prisma.InputJsonValue,
): Promise<string | null> {
  const [row] = await client.notification.createManyAndReturn({
    data: [{
      userId,
      type,
      title,
      body,
      payload: payload ?? {},
      channel: "IN_APP",
      sentAt: new Date(),
      dedupeKey,
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Post-commit variant: a failed inbox write must not fail a committed trade. */
export async function notifyAfterCommit(
  userId: string,
  type: string,
  title: string,
  body: string,
  dedupeKey: string,
  payload?: Prisma.InputJsonValue,
): Promise<string | null> {
  try {
    return await writeTradeNotification(db, userId, type, title, body, dedupeKey, payload);
  } catch (err) {
    console.error(`[TRADES] Failed to write ${type} notification:`, err);
    return null;
  }
}

/** Who is performing a trade mutation. Role gates staff-on-behalf actions. */
export type TradeActor = { id: string; role?: string | null };
export type TradeApprovalActor = { id: string; role: Role } | null;

export type TradePushJob = {
  userId: string;
  title: string;
  /** The event name, shown under the title; `body` then leaves it out. */
  subtitle?: string;
  body: string;
  notificationId?: string;
  payload: Record<string, unknown>;
  /** Defaults to `trade`; admin reviews use `reviewQueue`. */
  category?: NotificationCategory;
};

/** A claim waiting on Admin. Fanned out to reviewers after the claim commits. */
export type TradeReviewJob = {
  tradeId: string;
  /** The claim this review is for; a re-claimed trade needs a fresh review. */
  claimCycle: string;
  title: string;
  body: string;
  subtitle: string;
  pushBody: string;
  payload: Record<string, unknown>;
};

export async function dispatchTradeSideEffects({
  pushJobs,
  emailJobs,
}: {
  pushJobs: TradePushJob[];
  emailJobs: ShiftTradeEmail[];
}) {
  await Promise.allSettled(pushJobs.map((job) =>
    sendPushToUser(job.userId, {
      title: job.title,
      subtitle: job.subtitle,
      body: job.body,
      payload: job.payload,
      category: job.category ?? "trade",
      notificationId: job.notificationId,
    }),
  ));
  await sendShiftTradeEmails(emailJobs);
}

/**
 * Tell admins a claim is waiting on them. Runs after the claim commits: a
 * reviewer fanout has no business inside the SERIALIZABLE claim transaction,
 * where it would widen the read set that two students racing a trade contend
 * over. Per-reviewer dedupe keys make a retried dispatch idempotent.
 */
export async function notifyTradeReviewers(jobs: TradeReviewJob[]) {
  if (jobs.length === 0) return;

  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const pushJobs: TradePushJob[] = [];
  for (const job of jobs) {
    for (const reviewer of reviewers) {
      const created = await notifyAfterCommit(
        reviewer.id,
        "trade_review_required",
        job.title,
        job.body,
        `trade_review_required_${job.tradeId}_${job.claimCycle}_${reviewer.id}`,
        job.payload as Prisma.InputJsonValue,
      );
      if (created) {
        pushJobs.push({
          userId: reviewer.id,
          title: job.title,
          subtitle: job.subtitle,
          body: job.pushBody,
          payload: job.payload,
          category: "reviewQueue",
          notificationId: created,
        });
      }
    }
  }

  await dispatchTradeSideEffects({ pushJobs, emailJobs: [] });
}

export function isTradeManager(actor: TradeActor): boolean {
  return actor.role === "STAFF" || actor.role === "ADMIN";
}

export async function sendShiftTradeEmails(jobs: ShiftTradeEmail[]) {
  if (jobs.length === 0) return;

  await Promise.allSettled(
    jobs.map((job) =>
      sendShiftTradeEmail(job).catch((err) => {
        console.error(`[SHIFT_TRADES] Failed to send trade email to user ${job.userId}:`, err);
        return false;
      })
    )
  );
}
