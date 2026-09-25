import { Prisma, Role, ShiftTradeStatus, type ShiftArea } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { sendShiftTradeEmail, type ShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { sendPushToUser } from "@/lib/services/notifications";
import { scheduleNotificationPayload } from "@/lib/services/schedule-notification-policy";
import { badges } from "@/lib/badges";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";
import { availabilityContextFromBlocks } from "@/lib/schedule-availability-context";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { withSerializationRetry } from "@/lib/serialization";
import type { NotificationCategory } from "@/lib/notification-catalog";
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { enqueuePendingClaimReview } from "@/lib/claim-review-workflow";
import { createAuditEntryTx } from "@/lib/audit";
import { claimReviewDeadlines } from "@/lib/claim-review-deadlines";
import {
  claimableShiftAreas,
  shiftClaimEligibilityReason,
  type ShiftClaimProfile,
} from "@/lib/shift-claim-eligibility";

function assertShiftNotStarted(startsAt: Date) {
  if (startsAt <= new Date()) {
    throw new HttpError(400, "This shift has already started");
  }
}

function effectiveAssignmentWindow(assignment: {
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

function futureEffectiveAssignmentWhere(now: Date): Prisma.ShiftAssignmentWhereInput {
  return {
    OR: [
      { callStartsAt: { gt: now } },
      { callStartsAt: null, shift: { callStartsAt: { gt: now } } },
      { callStartsAt: null, shift: { callStartsAt: null, startsAt: { gt: now } } },
    ],
  };
}

function staleEffectiveAssignmentWhere(now: Date): Prisma.ShiftAssignmentWhereInput {
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
const tradeResponseInclude = {
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
const tradeEventStateSelect = {
  status: true,
  archivedAt: true,
  isHidden: true,
} satisfies Prisma.CalendarEventSelect;

/**
 * Mirrors the open-work board filter: a cancelled, archived, or hidden event
 * (or an archived crew) no longer has a shift anyone should claim or take over.
 */
const liveTradeEventWhere = {
  shiftAssignment: {
    shift: {
      shiftGroup: {
        archivedAt: null,
        event: { isHidden: false, archivedAt: null, status: { not: "CANCELLED" } },
      },
    },
  },
} satisfies Prisma.ShiftTradeWhereInput;

function assertTradeEventLive(shiftGroup: {
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

const availabilityBlockSelect = {
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

type NotificationWriter = Pick<Prisma.TransactionClient, "notification">;

/**
 * Writes one inbox row and reports whether it is new. `skipDuplicates` turns a
 * repeated dedupe key into a no-op instead of a unique violation, which inside
 * a transaction would abort the whole trade mutation. Returns the new row's
 * id, or null for a duplicate; callers only push or email for a new row, so a
 * retry never re-sends.
 */
async function writeTradeNotification(
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
async function notifyAfterCommit(
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
type TradeActor = { id: string; role?: string | null };
export type TradeApprovalActor = { id: string; role: Role } | null;

type TradePushJob = {
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
type TradeReviewJob = {
  tradeId: string;
  /** The claim this review is for; a re-claimed trade needs a fresh review. */
  claimCycle: string;
  title: string;
  body: string;
  subtitle: string;
  pushBody: string;
  payload: Record<string, unknown>;
};

async function dispatchTradeSideEffects({
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
async function notifyTradeReviewers(jobs: TradeReviewJob[]) {
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

function isTradeManager(actor: TradeActor): boolean {
  return actor.role === "STAFF" || actor.role === "ADMIN";
}

/**
 * Post a shift assignment to the trade board.
 * Owners post their own shifts; staff/admin may post a student's shift on
 * their behalf (the owner stays the poster of record so claim/cancel flows
 * and notifications key off the person actually holding the shift).
 */
export async function postTrade(
  shiftAssignmentId: string,
  actor: TradeActor,
  notes?: string
) {
  const pushJobs: TradePushJob[] = [];
  const emailJobs: ShiftTradeEmail[] = [];

  // Every SERIALIZABLE trade mutation retries one lost race, like claim. The
  // retry re-runs the body, so the side-effect buffers reset first.
  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: shiftAssignmentId },
      include: {
        shift: {
          include: {
            shiftGroup: {
              include: {
                workingCopy: { select: { version: true } },
                event: { select: { id: true, summary: true } },
              },
            },
          },
        },
        user: { select: { id: true, name: true, role: true, staffingType: true } },
      },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
    // Same gate every sibling schedule mutation applies. A post filed against a
    // shift staff are still redrafting advertises coverage that the pending
    // publish can move or delete, and no claim on it could be approved anyway.
    assertNoWorkingCopy(assignment.shift.shiftGroup?.workingCopy);
    const isOwner = assignment.userId === actor.id;
    if (!isOwner) {
      if (!isTradeManager(actor)) {
        throw new HttpError(403, "You can only trade your own shifts");
      }
      if (shiftWorkerTypeForProfile(assignment.user) !== "ST") {
        throw new HttpError(403, "Only student shifts can be posted to the Trade Board for someone else");
      }
    }
    if (
      !(ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)
    ) {
      throw new HttpError(400, "Only active assignments can be traded");
    }
    assertShiftNotStarted(effectiveAssignmentWindow(assignment).startsAt);

    // Check no existing open trade for this assignment
    const existing = await tx.shiftTrade.findFirst({
      where: {
        shiftAssignmentId,
        status: { in: ["OPEN", "CLAIMED"] },
      },
    });
    if (existing) {
      throw new HttpError(409, "This shift already has an open trade");
    }

    const trade = await tx.shiftTrade.create({
      data: {
        shiftAssignmentId,
        // The shift owner is the poster of record even when staff posts on
        // their behalf: they receive claim/complete notifications, keep the
        // cancel right, and stay blocked from claiming their own shift. The
        // staff actor is captured in the route's audit entry.
        postedByUserId: assignment.userId,
        notes,
      },
      include: {
        shiftAssignment: {
          include: {
            shift: {
              include: {
                shiftGroup: { include: { event: true } },
              },
            },
            user: { select: { id: true, name: true, primaryArea: true } },
          },
        },
        postedBy: { select: { id: true, name: true } },
      },
    });

    if (!isOwner) {
      // The owner must hear about it — a silently posted shift is how
      // someone shows up for work they no longer have.
      const eventSummary = assignment.shift.shiftGroup?.event?.summary ?? "an event";
      const title = "Your shift is on the Trade Board";
      const body = `Staff posted your ${assignment.shift.area} shift at ${eventSummary} to the Trade Board. You're still on the schedule until an Admin approves a claim.`;
      const pushBody = `Staff posted your ${assignment.shift.area} shift. You're still on it until an Admin approves a claim.`;
      const payload = scheduleNotificationPayload({
        tradeId: trade.id,
        assignmentId: assignment.id,
        shiftId: assignment.shiftId,
        eventId: assignment.shift.shiftGroup.event.id,
      });
      const notificationId = await writeTradeNotification(tx, assignment.userId, "trade_posted", title, body, `trade_posted_for_${trade.id}`, payload);
      if (notificationId) {
        pushJobs.push({ userId: assignment.userId, title, subtitle: eventSummary, body: pushBody, payload, notificationId });
        emailJobs.push({
          userId: assignment.userId,
          title,
          body,
          eventSummary,
          area: assignment.shift.area,
        });
      }
    }

    return trade;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
    onRetry: () => {
      pushJobs.length = 0;
      emailJobs.length = 0;
    },
  });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

/**
 * Claim an open trade. The claim is a request: it holds the post and waits for
 * an Admin approve/decline. The poster keeps the assignment until `approveTrade`
 * runs the swap, so a claim alone never leaves a shift uncovered.
 */
export async function claimTrade(tradeId: string, userId: string) {
  const emailJobs: ShiftTradeEmail[] = [];
  const pushJobs: TradePushJob[] = [];
  const reviewJobs: TradeReviewJob[] = [];

  // Two students claiming the same trade is the expected race here, so a lost
  // serialization conflict retries once instead of surfacing as a failure. The
  // retry re-runs the transaction body, so the side-effect buffers must be
  // cleared first or the second attempt would double-send.
  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({
      where: { id: tradeId },
      include: {
        shiftAssignment: {
          include: {
            shift: {
              include: {
                shiftGroup: {
                  include: {
                    workingCopy: { select: { version: true } },
                    event: { select: { summary: true, ...tradeEventStateSelect } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!trade) throw new HttpError(404, "Trade not found");
    if (trade.status !== "OPEN") {
      throw new HttpError(409, "Trade is no longer open");
    }
    if (trade.postedByUserId === userId) {
      throw new HttpError(400, "You cannot claim your own trade");
    }

    // Validate claimant doesn't have a conflicting shift during this time
    const shift = trade.shiftAssignment.shift;
    assertNoWorkingCopy(shift.shiftGroup?.workingCopy);
    assertTradeEventLive(shift.shiftGroup);
    const window = effectiveAssignmentWindow(trade.shiftAssignment);
    assertShiftNotStarted(window.startsAt);
    await checkTimeConflict(tx, userId, window.startsAt, window.endsAt);

    // Validate the same primary-area claim rule used to shape the board.
    const claimant = await tx.user.findUnique({
      where: { id: userId },
      select: {
        primaryArea: true,
        role: true,
        staffingType: true,
        active: true,
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    });
    if (!claimant) throw new HttpError(404, "User not found");
    const eligibilityReason = shiftClaimEligibilityReason(claimant, shift);
    if (eligibilityReason) throw new HttpError(400, eligibilityReason);
    const availabilityContext = availabilityContextFromBlocks(claimant.availabilityBlocks ?? [], window);
    if (availabilityContext?.blocking) {
      throw new HttpError(409, availabilityContext.detail);
    }

    const eventSummary =
      trade.shiftAssignment.shift.shiftGroup?.event?.summary ?? "your shift";

    // These two guards used to ride along inside `executeSwap`, which claiming
    // no longer runs. They have to stay at claim time regardless: without them a
    // student can claim a post whose shift the poster already lost or someone
    // else already filled, then wait on a review that can only ever decline.
    const posted = await tx.shiftAssignment.findUnique({
      where: { id: trade.shiftAssignmentId },
      include: { shift: true },
    });
    if (!posted) throw new HttpError(404, "Assignment not found for this trade");
    if (!(ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(posted.status)) {
      throw new HttpError(409, "The posted shift is no longer held by the poster, so it can't be claimed");
    }
    const refilled = await tx.shiftAssignment.findFirst({
      where: {
        shiftId: posted.shiftId,
        id: { not: posted.id },
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      },
      select: { id: true },
    });
    if (refilled) {
      throw new HttpError(409, "This shift already has an active assignment");
    }

    // The swap itself waits for Admin. Until an admin approves, the poster keeps the
    // assignment: a claim is a request to be released, not the release.
    const claimed = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        claimedByUserId: userId,
        claimedAt: new Date(),
        status: "CLAIMED",
      },
      include: tradeResponseInclude,
    });

    const claimerName = claimed.claimedBy?.name ?? "Someone";
    // Withdraw and decline return the post to OPEN, so one trade can be claimed
    // more than once; each claim gets its own rows and review.
    const claimCycle = claimed.claimedAt?.toISOString() ?? "unknown";
    const payload = scheduleNotificationPayload({
      tradeId,
      assignmentId: claimed.shiftAssignment.id,
      shiftId: claimed.shiftAssignment.shift.id,
      eventId: claimed.shiftAssignment.shift.shiftGroup.event.id,
    });

    // Poster: someone wants it, but they are still on the hook until Admin acts.
    // Saying only "claimed" is how a person stops showing up for a shift they
    // still hold.
    const posterTitle = "Your trade was claimed";
    const posterBody = `${claimerName} claimed your ${shift.area} shift at ${eventSummary}. You're still on the schedule until an Admin approves the trade.`;
    const posterPushBody = `${claimerName} wants your ${shift.area} shift. You're still on it until an Admin approves.`;
    const posterNotificationId = await writeTradeNotification(
      tx,
      trade.postedByUserId,
      "trade_claimed",
      posterTitle,
      posterBody,
      `trade_claimed_${tradeId}_${claimCycle}`,
      payload,
    );
    if (posterNotificationId) {
      pushJobs.push({
        userId: trade.postedByUserId,
        title: posterTitle,
        subtitle: eventSummary,
        body: posterPushBody,
        payload,
        notificationId: posterNotificationId,
      });
      emailJobs.push({
        userId: trade.postedByUserId,
        title: posterTitle,
        body: posterBody,
        eventSummary,
        area: shift.area,
      });
    }

    // Claimer: say plainly that they are not on the schedule yet.
    const claimerTitle = "Claim sent for approval";
    const claimerBody = `Your claim on the ${shift.area} shift at ${eventSummary} is waiting for Admin approval. You're not on the schedule until it's approved.`;
    const claimerPushBody = `You're not on the ${shift.area} shift until an Admin approves.`;
    const claimerNotificationId = await writeTradeNotification(
      tx,
      userId,
      "trade_claim_pending",
      claimerTitle,
      claimerBody,
      `trade_claim_pending_${tradeId}_${claimCycle}`,
      payload,
    );
    if (claimerNotificationId) {
      pushJobs.push({
        userId,
        title: claimerTitle,
        subtitle: eventSummary,
        body: claimerPushBody,
        payload,
        notificationId: claimerNotificationId,
      });
    }

    reviewJobs.push({
      tradeId,
      claimCycle,
      title: "Trade claim needs review",
      body: `${claimerName} claimed ${claimed.postedBy?.name ?? "a teammate"}'s ${shift.area} shift at ${eventSummary}.`,
      subtitle: eventSummary,
      pushBody: `${claimerName} wants ${claimed.postedBy?.name ?? "a teammate"}'s ${shift.area} shift.`,
      payload,
    });

    return claimed;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
    onRetry: () => {
      emailJobs.length = 0;
      pushJobs.length = 0;
      reviewJobs.length = 0;
    },
  });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  await notifyTradeReviewers(reviewJobs);
  await enqueuePendingClaimReview({
    kind: "trade",
    claimId: result.id,
    shiftStartsAt: effectiveAssignmentWindow(result.shiftAssignment).startsAt,
    // Pins the timer to this claim. Withdraw and decline reopen the post, so a
    // timer from an earlier claim must not approve a later one early.
    claimedAt: result.claimedAt,
  });
  return result;
}

/**
 * Let the claimer withdraw while the trade is still waiting for Admin. The
 * post returns to OPEN; the original assignment never changes hands.
 */
export async function withdrawTradeClaim(
  tradeId: string,
  actor: { id: string; role: Role },
) {
  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({
      where: { id: tradeId },
      include: {
        shiftAssignment: {
          include: {
            shift: {
              include: {
                shiftGroup: {
                  include: {
                    workingCopy: { select: { version: true } },
                    event: true,
                  },
                },
              },
            },
          },
        },
        postedBy: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
      },
    });
    if (!trade) throw new HttpError(404, "Trade not found");
    if (trade.status !== "CLAIMED") {
      throw new HttpError(409, "Only claimed trades can be withdrawn");
    }
    if (trade.claimedByUserId !== actor.id) {
      throw new HttpError(403, "You can only withdraw your own trade claim");
    }
    assertNoWorkingCopy(trade.shiftAssignment.shift.shiftGroup?.workingCopy);

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        claimedByUserId: null,
        claimedAt: null,
        status: "OPEN",
      },
      include: tradeResponseInclude,
    });

    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "shift_trade",
      entityId: tradeId,
      action: "trade_claim_withdrawn",
      before: {
        status: trade.status,
        claimedByUserId: trade.claimedByUserId,
        claimedAt: trade.claimedAt?.toISOString() ?? null,
      },
      after: {
        status: updated.status,
        claimedByUserId: updated.claimedByUserId,
        claimedAt: updated.claimedAt?.toISOString() ?? null,
      },
    });

    return {
      trade: updated,
      posterUserId: trade.postedByUserId,
      claimerName: trade.claimedBy?.name ?? "The claimer",
      claimCycle: trade.claimedAt?.toISOString() ?? "unknown",
      area: trade.shiftAssignment.shift.area,
      eventSummary: trade.shiftAssignment.shift.shiftGroup?.event?.summary ?? "the event",
      payload: scheduleNotificationPayload({
        tradeId,
        assignmentId: trade.shiftAssignment.id,
        shiftId: trade.shiftAssignment.shift.id,
        eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  const title = "Trade claim withdrawn";
  const body = `${result.claimerName} withdrew their claim for your ${result.area} shift at ${result.eventSummary}. The post is back on the Trade Board.`;
  const created = await notifyAfterCommit(
    result.posterUserId,
    "trade_claim_withdrawn",
    title,
    body,
    `trade_claim_withdrawn_${tradeId}_${result.claimCycle}`,
    result.payload,
  );
  if (!created) return result.trade;
  await dispatchTradeSideEffects({
    pushJobs: [{
      userId: result.posterUserId,
      title,
      subtitle: result.eventSummary,
      body: `${result.claimerName} backed out. Your ${result.area} shift is back on the Trade Board.`,
      payload: result.payload,
      notificationId: created,
    }],
    emailJobs: [{
      userId: result.posterUserId,
      title,
      body,
      eventSummary: result.eventSummary,
      area: result.area,
    }],
  });
  return result.trade;
}

/**
 * Admin approves a claimed trade → executes swap.
 *
 * `expectedClaimedAt` pins an automatic approval to the claim its timer was
 * started for; a human approval omits it and acts on whatever claim is current.
 */
export async function approveTrade(
  tradeId: string,
  actor: TradeApprovalActor = null,
  options: { expectedClaimedAt?: string } = {},
) {
  const emailJobs: ShiftTradeEmail[] = [];
  const pushJobs: TradePushJob[] = [];
  const badgeJobs: Array<Parameters<typeof badges.onTradeCompleted>[0]> = [];

  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({
      where: { id: tradeId },
      include: {
        shiftAssignment: {
          include: {
            shift: {
              include: {
                shiftGroup: {
                  include: {
                    workingCopy: { select: { version: true } },
                    event: { select: { id: true, summary: true, ...tradeEventStateSelect } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!trade) throw new HttpError(404, "Trade not found");
    if (trade.status !== "CLAIMED") {
      throw new HttpError(409, "Only claimed trades can be approved");
    }
    if (!trade.claimedByUserId) {
      throw new HttpError(400, "Trade has no claimer");
    }
    if (
      options.expectedClaimedAt !== undefined
      && trade.claimedAt?.toISOString() !== options.expectedClaimedAt
    ) {
      throw new HttpError(409, "This trade was claimed again after the review timer started");
    }
    assertNoWorkingCopy(trade.shiftAssignment.shift.shiftGroup?.workingCopy);
    assertTradeEventLive(trade.shiftAssignment.shift.shiftGroup);
    assertShiftNotStarted(effectiveAssignmentWindow(trade.shiftAssignment).startsAt);

    await executeSwap(tx, trade.shiftAssignment.id, trade.claimedByUserId, actor?.id ?? null);

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: { resolvedAt: new Date(), status: "COMPLETED" },
      include: tradeResponseInclude,
    });
    await createAuditEntryTx(tx, {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      entityType: "shift_trade",
      entityId: tradeId,
      action: actor ? "trade_approved" : "trade_auto_approved",
      before: { status: trade.status, claimedByUserId: trade.claimedByUserId },
      after: { status: updated.status, claimedByUserId: updated.claimedByUserId },
    });
    queueTradeCompletedIfTransitioned(badgeJobs, updated, trade.status);

    const area = trade.shiftAssignment.shift.area;
    const eventSummary = trade.shiftAssignment.shift.shiftGroup?.event?.summary ?? "your shift";

    const title = "Trade approved";
    const body = `Your trade for the ${area} shift at ${eventSummary} was approved. You're on the schedule.`;
    const pushBody = `You're on the ${area} shift now.`;
    const payload = scheduleNotificationPayload({
      tradeId,
      assignmentId: trade.shiftAssignment.id,
      shiftId: trade.shiftAssignment.shift.id,
      eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
    });

    // Notify claimer: swap is confirmed
    const claimerNotificationId = await writeTradeNotification(
      tx,
      trade.claimedByUserId,
      "trade_approved",
      title,
      body,
      `trade_approved_${tradeId}`,
      payload,
    );
    if (claimerNotificationId) {
      pushJobs.push({
        userId: trade.claimedByUserId,
        title,
        subtitle: eventSummary,
        body: pushBody,
        payload,
        notificationId: claimerNotificationId,
      });
      emailJobs.push({
        userId: trade.claimedByUserId,
        title,
        body,
        eventSummary,
        area,
      });
    }

    // The outgoing worker needs a separate confirmation: the claimer is now
    // on the schedule, but the poster is no longer responsible for the slot.
    const posterTitle = "You're off the shift";
    const posterBody = `Your trade for the ${area} shift at ${eventSummary} was approved. You're no longer on the schedule.`;
    const posterNotificationId = await writeTradeNotification(
      tx,
      trade.postedByUserId,
      "trade_approved_poster",
      posterTitle,
      posterBody,
      `trade_approved_poster_${tradeId}`,
      payload,
    );
    if (posterNotificationId) {
      pushJobs.push({
        userId: trade.postedByUserId,
        title: posterTitle,
        subtitle: eventSummary,
        body: `Your trade for the ${area} shift was approved.`,
        payload,
        notificationId: posterNotificationId,
      });
      emailJobs.push({
        userId: trade.postedByUserId,
        title: posterTitle,
        body: posterBody,
        eventSummary,
        area,
      });
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
    onRetry: () => {
      emailJobs.length = 0;
      pushJobs.length = 0;
      badgeJobs.length = 0;
    },
  });

  await Promise.all(badgeJobs.map((event) => badges.onTradeCompleted(event)));
  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

/**
 * Admin declines a claimed trade → back to OPEN.
 */
export async function declineTrade(tradeId: string, actor: TradeApprovalActor = null) {
  const emailJobs: ShiftTradeEmail[] = [];
  const pushJobs: TradePushJob[] = [];

  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({
      where: { id: tradeId },
      include: {
        shiftAssignment: {
          include: {
            shift: {
              include: { shiftGroup: { include: { event: { select: { id: true, summary: true } } } } },
            },
          },
        },
      },
    });
    if (!trade) throw new HttpError(404, "Trade not found");
    if (trade.status !== "CLAIMED") {
      throw new HttpError(409, "Only claimed trades can be declined");
    }

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        claimedByUserId: null,
        claimedAt: null,
        status: "OPEN",
      },
      include: tradeResponseInclude,
    });

    // Written in the transaction, like approve and withdraw. A decline is the
    // one review outcome that leaves no trace on the trade row — the claimer is
    // cleared — so without this entry there is no record of who was turned down.
    await createAuditEntryTx(tx, {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      entityType: "shift_trade",
      entityId: tradeId,
      action: "trade_declined",
      before: {
        status: trade.status,
        claimedByUserId: trade.claimedByUserId,
        claimedAt: trade.claimedAt?.toISOString() ?? null,
      },
      after: { status: updated.status, claimedByUserId: updated.claimedByUserId },
    });

    // Notify claimer: declined, trade is back open
    if (trade.claimedByUserId) {
      const area = trade.shiftAssignment.shift.area;
      const eventSummary = trade.shiftAssignment.shift.shiftGroup?.event?.summary ?? "the event";
      const title = "Trade claim declined";
      const body = `Your claim on the ${area} shift at ${eventSummary} was declined. The shift is back on the Trade Board.`;
      const payload = scheduleNotificationPayload({
        tradeId,
        assignmentId: trade.shiftAssignment.id,
        shiftId: trade.shiftAssignment.shift.id,
        eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
      });

      // Keyed on the claim being declined, not the wall clock: a retried
      // dispatch must not tell the same student twice, while a later claim on
      // the same post carries a new `claimedAt` and so still gets its own notice.
      const notificationId = await writeTradeNotification(
        tx,
        trade.claimedByUserId,
        "trade_declined",
        title,
        body,
        `trade_declined_${tradeId}_${trade.claimedAt?.toISOString() ?? "unknown"}`,
        payload,
      );
      if (notificationId) {
        pushJobs.push({
          userId: trade.claimedByUserId,
          title,
          subtitle: eventSummary,
          body: `The ${area} shift is back on the Trade Board.`,
          payload,
          notificationId,
        });
        emailJobs.push({
          userId: trade.claimedByUserId,
          title,
          body,
          eventSummary,
          area,
        });
      }
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
    onRetry: () => {
      emailJobs.length = 0;
      pushJobs.length = 0;
    },
  });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

/**
 * Cancel a trade: the poster (shift owner) can always cancel their own;
 * staff/admin can remove any post from the Trade Board (the owner is told).
 */
export async function cancelTrade(tradeId: string, actor: TradeActor) {
  const pushJobs: TradePushJob[] = [];
  const emailJobs: ShiftTradeEmail[] = [];

  const result = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({
      where: { id: tradeId },
      include: {
        shiftAssignment: {
          include: {
            shift: { include: { shiftGroup: { include: { event: true } } } },
          },
        },
      },
    });
    if (!trade) throw new HttpError(404, "Trade not found");
    const isPoster = trade.postedByUserId === actor.id;
    if (!isPoster && !isTradeManager(actor)) {
      throw new HttpError(403, "You can only cancel your own trades");
    }
    if (trade.status !== "OPEN" && trade.status !== "CLAIMED") {
      throw new HttpError(409, "Trade cannot be cancelled in its current state");
    }

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        resolvedAt: new Date(),
        status: "CANCELLED",
      },
      include: tradeResponseInclude,
    });

    if (!isPoster) {
      const shift = updated.shiftAssignment.shift;
      const eventSummary = shift.shiftGroup?.event?.summary ?? "an event";
      const title = "Removed from the Trade Board";
      const body = `Staff removed your ${shift.area} shift at ${eventSummary} from the Trade Board. You're still on the schedule for it.`;
      const payload = scheduleNotificationPayload({
        tradeId,
        assignmentId: updated.shiftAssignment.id,
        shiftId: shift.id,
        eventId: shift.shiftGroup.event.id,
      });
      const notificationId = await writeTradeNotification(tx, trade.postedByUserId, "trade_cancelled", title, body, `trade_cancelled_by_staff_${tradeId}`, payload);
      if (notificationId) {
        pushJobs.push({
          userId: trade.postedByUserId,
          title,
          subtitle: eventSummary,
          body: `You're still on the ${shift.area} shift.`,
          payload,
          notificationId,
        });
        emailJobs.push({
          userId: trade.postedByUserId,
          title,
          body,
          eventSummary,
          area: shift.area,
        });
      }
    }

    if (trade.claimedByUserId) {
      const shift = updated.shiftAssignment.shift;
      const eventSummary = shift.shiftGroup?.event?.summary ?? "the event";
      // Distinct from "Trade claim withdrawn", which is the claimer backing out.
      const title = "Trade post removed";
      const body = isPoster
        ? `The poster removed the ${shift.area} shift at ${eventSummary} from the Trade Board. Your claim is no longer active.`
        : `Staff removed the ${shift.area} shift at ${eventSummary} from the Trade Board. Your claim is no longer active.`;
      const pushBody = `Your claim on the ${shift.area} shift is cancelled.`;
      const payload = scheduleNotificationPayload({
        tradeId,
        assignmentId: updated.shiftAssignment.id,
        shiftId: shift.id,
        eventId: shift.shiftGroup.event.id,
      });
      const claimCycle = trade.claimedAt?.toISOString() ?? "unknown";
      const notificationId = await writeTradeNotification(
        tx,
        trade.claimedByUserId,
        "trade_claim_cancelled",
        title,
        body,
        `trade_claim_cancelled_${tradeId}_${claimCycle}`,
        payload,
      );
      if (notificationId) {
        pushJobs.push({
          userId: trade.claimedByUserId,
          title,
          subtitle: eventSummary,
          body: pushBody,
          payload,
          notificationId,
        });
        emailJobs.push({
          userId: trade.claimedByUserId,
          title,
          body,
          eventSummary,
          area: shift.area,
        });
      }
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), {
    onRetry: () => {
      pushJobs.length = 0;
      emailJobs.length = 0;
    },
  });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

const tradeListInclude = {
  shiftAssignment: {
    include: {
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  endsAt: true,
                  allDay: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  site: true,
                },
              },
            },
          },
        },
      },
      user: { select: { id: true, name: true, primaryArea: true } },
    },
  },
  postedBy: { select: { id: true, name: true } },
  claimedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShiftTradeInclude;

/**
 * List trades, optionally filtered by status and area.
 */
export async function listTrades(filters: {
  status?: ShiftTradeStatus;
  area?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.ShiftTradeWhereInput = {};
  const and: Prisma.ShiftTradeWhereInput[] = [];
  const viewerRows = filters.userId
    ? await db.user.findMany({
      where: { id: { in: [filters.userId] } },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        primaryArea: true,
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    })
    : [];
  const viewer = viewerRows[0] ?? null;
  if (filters.status) where.status = filters.status;
  if (filters.area) {
    and.push({ shiftAssignment: { shift: { area: filters.area as ShiftArea } } });
  }
  const actionableStatuses: ShiftTradeStatus[] = ["OPEN", "CLAIMED"];
  const now = new Date();
  // Resolved history stays visible; only a post someone could still act on
  // must be on a future shift of a live event.
  if (filters.status && actionableStatuses.includes(filters.status)) {
    and.push({ shiftAssignment: futureEffectiveAssignmentWhere(now) });
    and.push(liveTradeEventWhere);
  } else if (!filters.status) {
    and.push({
      OR: [
        { status: { notIn: actionableStatuses } },
        { AND: [{ shiftAssignment: futureEffectiveAssignmentWhere(now) }, liveTradeEventWhere] },
      ],
    });
  }
  if (filters.userId && viewer?.role === "STUDENT") {
    and.push({
      OR: [
        { status: { not: "OPEN" } },
        { postedByUserId: filters.userId },
        {
          shiftAssignment: {
            shift: { area: { in: claimableShiftAreas(viewer.primaryArea) } },
          },
        },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const include = tradeListInclude;
  // Actionable before resolved, then newest first. `ShiftTradeStatus` is
  // declared OPEN, CLAIMED, APPROVED, COMPLETED, CANCELLED, so ascending
  // status puts everything someone still owes a decision on ahead of history.
  // Without it an unfiltered page is pure recency, and COMPLETED/CANCELLED
  // rows accumulate forever — a season in, a claim waiting on Admin falls off
  // the end of the window and out of the review queue entirely. `id` is the
  // tiebreaker so offset paging (native "load more") cannot repeat or skip a
  // row when two trades share a timestamp.
  const orderBy: Prisma.ShiftTradeOrderByWithRelationInput[] = [
    { status: "asc" },
    { postedAt: "desc" },
    { id: "asc" },
  ];
  const data = viewer?.role === "ADMIN" && !filters.status
    ? await findClaimedFirstPage(where, include, orderBy, filters.limit, filters.offset)
    : await db.shiftTrade.findMany({
      where,
      take: filters.limit,
      skip: filters.offset,
      include,
      orderBy,
    });
  const total = await db.shiftTrade.count({ where });
  // Another student's availability — a time-off reason, a standing note — is
  // for the people deciding the claim, not the rest of the board.
  const canSeeClaimerAvailability = viewer?.role === "ADMIN" || viewer?.role === "STAFF";
  const availabilityUserIds = new Set<string>();
  for (const trade of canSeeClaimerAvailability ? data : []) {
    if (trade.status === "CLAIMED" && trade.claimedByUserId) {
      availabilityUserIds.add(trade.claimedByUserId);
    }
  }
  const relatedAvailabilityUsers = availabilityUserIds.size > 0
    ? await db.user.findMany({
      where: { id: { in: [...availabilityUserIds] } },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        primaryArea: true,
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    })
    : [];
  const availabilityUsers = [...viewerRows, ...relatedAvailabilityUsers];
  const usersById = new Map(availabilityUsers.map((user) => [user.id, user]));
  const viewerBlocks = viewer?.availabilityBlocks ?? [];

  return {
    data: data.map((trade) => {
      const window = effectiveAssignmentWindow(trade.shiftAssignment);
      const reviewDeadlines = trade.status === "CLAIMED"
        ? claimReviewDeadlines(window.startsAt, trade.claimedAt ?? now)
        : null;
      const viewerAvailabilityContext = filters.userId && trade.postedByUserId !== filters.userId
        ? availabilityContextFromBlocks(viewerBlocks, window)
        : null;
      const claimedByAvailabilityContext = canSeeClaimerAvailability && trade.claimedByUserId
        ? availabilityContextFromBlocks(usersById.get(trade.claimedByUserId)?.availabilityBlocks ?? [], window)
        : null;
      const viewerEligibilityReason = viewer
        ? shiftClaimEligibilityReason(viewer as ShiftClaimProfile, trade.shiftAssignment.shift)
        : null;
      let viewerCanClaim = false;
      let viewerClaimReason: string | null = null;
      if (trade.status === "CLAIMED") {
        // "Not open" is true but useless here. Whoever is looking is either the
        // person waiting on the decision or the person who has to make it.
        viewerClaimReason = trade.claimedByUserId === filters.userId
          ? "Waiting for an admin to approve your claim"
          : trade.postedByUserId === filters.userId
            ? `${trade.claimedBy?.name ?? "Someone"} claimed this — waiting for Admin approval`
            : "Claimed and waiting for Admin approval";
      } else if (trade.status !== "OPEN") {
        viewerClaimReason = "This trade is not open";
      } else if (!filters.userId || !viewer) {
        viewerClaimReason = "Your scheduling profile is unavailable";
      } else if (trade.postedByUserId === filters.userId) {
        viewerClaimReason = "You posted this trade";
      } else if (viewerEligibilityReason) {
        viewerClaimReason = viewerEligibilityReason;
      } else if (viewerAvailabilityContext?.blocking) {
        viewerClaimReason = viewerAvailabilityContext.detail;
      } else {
        viewerCanClaim = true;
      }

      return {
        ...trade,
        viewerAvailabilityContext,
        claimedByAvailabilityContext,
        viewerCanClaim,
        viewerClaimReason,
        reviewEscalatesAt: reviewDeadlines?.escalateAt.toISOString() ?? null,
        reviewAutoApprovesAt: reviewDeadlines?.autoApproveAt.toISOString() ?? null,
      };
    }),
    total,
  };
}

/**
 * One page of the unfiltered board with CLAIMED rows ahead of everything else.
 * Admin works the review queue from page one; the enum order alone puts every
 * OPEN post ahead of it. Pages the two slices back to back so offset paging
 * stays stable across the boundary.
 */
async function findClaimedFirstPage(
  where: Prisma.ShiftTradeWhereInput,
  include: typeof tradeListInclude,
  orderBy: Prisma.ShiftTradeOrderByWithRelationInput[],
  limit: number | undefined,
  offset: number | undefined,
) {
  const skip = offset ?? 0;
  const claimedWhere: Prisma.ShiftTradeWhereInput = { AND: [where, { status: "CLAIMED" }] };
  const restWhere: Prisma.ShiftTradeWhereInput = { AND: [where, { status: { not: "CLAIMED" } }] };
  const claimedCount = await db.shiftTrade.count({ where: claimedWhere });
  const claimed = skip < claimedCount
    ? await db.shiftTrade.findMany({ where: claimedWhere, take: limit, skip, include, orderBy })
    : [];
  const remaining = limit === undefined ? undefined : limit - claimed.length;
  if (remaining !== undefined && remaining <= 0) return claimed;
  const rest = await db.shiftTrade.findMany({
    where: restWhere,
    take: remaining,
    skip: Math.max(0, skip - claimedCount),
    include,
    orderBy,
  });
  return [...claimed, ...rest];
}

/**
 * Expire all OPEN/CLAIMED trades whose shift has already started.
 * Called by the morning-refresh cron. Notifies the original poster.
 */
export async function expireOpenTrades(): Promise<{ expired: number }> {
  const now = new Date();

  const staleTrades = await db.shiftTrade.findMany({
    where: {
      status: { in: ["OPEN", "CLAIMED"] },
      shiftAssignment: staleEffectiveAssignmentWhere(now),
    },
    select: {
      id: true,
      postedByUserId: true,
      claimedByUserId: true,
      shiftAssignment: {
        select: {
          shift: {
            select: {
              area: true,
              shiftGroup: {
                select: { event: { select: { id: true, summary: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (staleTrades.length === 0) return { expired: 0 };

  await db.shiftTrade.updateMany({
    where: {
      id: { in: staleTrades.map((t) => t.id) },
      status: { in: ["OPEN", "CLAIMED"] },
    },
    data: { status: "CANCELLED", resolvedAt: now },
  });

  // Notify posters and anyone left holding a claim (best-effort, skip
  // duplicates). A claimer who is told nothing is the dangerous case: they
  // asked for the shift, never heard a decision, and have no way to know the
  // request died rather than being approved.
  const expiryNotifications = staleTrades.flatMap((t) => {
    const area = t.shiftAssignment.shift.area;
    const eventSummary = t.shiftAssignment.shift.shiftGroup?.event?.summary ?? "the event";
    const payload = JSON.parse(JSON.stringify(scheduleNotificationPayload({
      tradeId: t.id,
      eventId: t.shiftAssignment.shift.shiftGroup.event.id,
    })));
    const rows = [{
      userId: t.postedByUserId,
      type: "trade_expired",
      title: "Trade expired",
      body: `Your trade post for the ${area} shift at ${eventSummary} expired because the shift has started.`,
      payload,
      channel: "IN_APP" as const,
      sentAt: now,
      dedupeKey: `trade_expired_${t.id}`,
    }];
    if (t.claimedByUserId && t.claimedByUserId !== t.postedByUserId) {
      rows.push({
        userId: t.claimedByUserId,
        type: "trade_claim_expired",
        title: "Trade claim expired",
        body: `Your claim on the ${area} shift at ${eventSummary} expired before an Admin decided. You weren't added to the shift.`,
        payload,
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `trade_claim_expired_${t.id}`,
      });
    }
    return rows;
  });

  await db.notification.createMany({
    data: expiryNotifications,
    skipDuplicates: true,
  });

  return { expired: staleTrades.length };
}

/* ── Internal helpers ── */

async function executeSwap(tx: Prisma.TransactionClient, assignmentId: string, targetUserId: string, actorId: string | null) {
  // Fetch assignment with shift times for conflict check
  const assignment = await tx.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: { shift: true },
  });
  if (!assignment) throw new HttpError(404, "Assignment not found during swap");
  if (!(ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)) {
    // The poster was removed from the shift after posting — completing the
    // trade would hand the claimer a slot the poster no longer holds.
    throw new HttpError(409, "The posted shift is no longer held by the poster, so this trade can't be completed");
  }
  const refilled = await tx.shiftAssignment.findFirst({
    where: {
      shiftId: assignment.shiftId,
      id: { not: assignmentId },
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
    },
    select: { id: true },
  });
  if (refilled) {
    throw new HttpError(409, "This shift already has an active assignment");
  }
  const effectiveWindow = effectiveAssignmentWindow(assignment);

  // Validate target user has no conflicting shifts (exclude the assignment being swapped)
  await checkTimeConflict(tx, targetUserId, effectiveWindow.startsAt, effectiveWindow.endsAt, assignmentId);

  // Revalidate every mutable claimant gate at approval time. Lookup failures
  // fail closed: eligibility cannot be treated as best-effort when this call is
  // about to move the assignment.
  const claimer = await tx.user.findUnique({
    where: { id: targetUserId },
    select: {
      active: true,
      role: true,
      staffingType: true,
      primaryArea: true,
      availabilityBlocks: {
        select: {
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
        },
      },
    },
  });
  if (!claimer) throw new HttpError(404, "Claiming user not found");
  const eligibilityReason = shiftClaimEligibilityReason(claimer, assignment.shift);
  if (eligibilityReason) throw new HttpError(409, eligibilityReason);
  const availability = evaluateAvailabilityPreferences(claimer.availabilityBlocks, effectiveWindow);
  if (availability.blocking) throw new HttpError(409, availability.blocking.note);
  const conflictNote = availability.advisory?.note ?? null;

  // Mark old assignment as SWAPPED
  await tx.shiftAssignment.update({
    where: { id: assignmentId },
    data: { status: "SWAPPED" },
  });

  // Create new assignment for claimer
  return tx.shiftAssignment.create({
    data: {
      shiftId: assignment.shiftId,
      userId: targetUserId,
      status: "DIRECT_ASSIGNED",
      assignedBy: actorId,
      swapFromId: assignmentId,
      // The poster's personal call window moves with the slot: conflicts and
      // availability were checked against it, so dropping it would schedule
      // the claimer for a window nobody validated.
      callStartsAt: assignment.callStartsAt,
      callEndsAt: assignment.callEndsAt,
      callNote: assignment.callNote,
      hasConflict: Boolean(conflictNote),
      conflictNote,
    },
  });
}

function queueTradeCompletedIfTransitioned(
  badgeJobs: Array<Parameters<typeof badges.onTradeCompleted>[0]>,
  trade: { id: string; status: ShiftTradeStatus; postedByUserId: string; claimedByUserId: string | null },
  prevStatus: ShiftTradeStatus,
) {
  if (prevStatus === "COMPLETED" || trade.status !== "COMPLETED") return;

  badgeJobs.push({
    userId: trade.postedByUserId,
    tradeId: trade.id,
    sourceKey: trade.id,
  });
  if (trade.claimedByUserId && trade.claimedByUserId !== trade.postedByUserId) {
    badgeJobs.push({
      userId: trade.claimedByUserId,
      tradeId: trade.id,
      sourceKey: trade.id,
    });
  }
}

async function sendShiftTradeEmails(jobs: ShiftTradeEmail[]) {
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
