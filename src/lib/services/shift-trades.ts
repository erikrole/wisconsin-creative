import { Prisma, Role, ShiftTradeStatus, type ShiftArea, type ShiftWorkerType } from "@prisma/client";
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
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { enqueuePendingClaimReview } from "@/lib/claim-review-workflow";
import { createAuditEntryTx } from "@/lib/audit";

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

async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  dedupeKey: string,
  payload?: Prisma.InputJsonValue,
) {
  try {
    await db.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        payload: payload ?? {},
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey,
      },
    });
  } catch {
    // Silently swallow duplicate/constraint errors — notifications are best-effort
  }
}

/** Who is performing a trade mutation. Role gates staff-on-behalf actions. */
export type TradeActor = { id: string; role?: string | null };
export type TradeApprovalActor = { id: string; role: Role } | null;

type TradeClaimProfile = {
  active: boolean;
  role: Role;
  staffingType: ShiftWorkerType;
  primaryArea: ShiftArea | null;
  areaAssignments?: Array<{ area: ShiftArea }>;
};

function tradeClaimEligibilityReason(
  profile: TradeClaimProfile,
  shift: { area: ShiftArea; workerType: ShiftWorkerType },
): string | null {
  if (!profile.active) return "Inactive users cannot claim shifts";
  if (shiftWorkerTypeForProfile(profile) !== shift.workerType) {
    return "Your scheduling class does not match this shift slot";
  }
  const hasAreaMembership = profile.primaryArea === shift.area
    || (profile.areaAssignments ?? []).some((assignment) => assignment.area === shift.area);
  if (!hasAreaMembership) {
    return `You are not assigned to this shift's area (${shift.area})`;
  }
  return null;
}

type TradePushJob = {
  userId: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
};

/** A claim waiting on staff. Fanned out to reviewers after the claim commits. */
type TradeReviewJob = {
  tradeId: string;
  title: string;
  body: string;
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
      body: job.body,
      payload: job.payload,
      category: "trade",
    }),
  ));
  await sendShiftTradeEmails(emailJobs);
}

/**
 * Tell staff a claim is waiting on them. Runs after the claim commits: a
 * reviewer fanout has no business inside the SERIALIZABLE claim transaction,
 * where it would widen the read set that two students racing a trade contend
 * over. Per-reviewer dedupe keys make a retried dispatch idempotent.
 */
async function notifyTradeReviewers(jobs: TradeReviewJob[]) {
  if (jobs.length === 0) return;

  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const pushJobs: TradePushJob[] = [];
  for (const job of jobs) {
    for (const reviewer of reviewers) {
      await notify(
        reviewer.id,
        "trade_review_required",
        job.title,
        job.body,
        `trade_review_required_${job.tradeId}_${reviewer.id}`,
        job.payload as Prisma.InputJsonValue,
      );
      pushJobs.push({ userId: reviewer.id, title: job.title, body: job.body, payload: job.payload });
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

  const result = await db.$transaction(async (tx) => {
    const assignment = await tx.shiftAssignment.findUnique({
      where: { id: shiftAssignmentId },
      include: {
        shift: { include: { shiftGroup: { include: { event: { select: { id: true, summary: true } } } } } },
        user: { select: { id: true, name: true, role: true, staffingType: true } },
      },
    });
    if (!assignment) throw new HttpError(404, "Assignment not found");
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
      const body = `Staff posted your ${assignment.shift.area} shift for ${eventSummary} to the Trade Board. You're still scheduled until staff approve a claim.`;
      const payload = scheduleNotificationPayload({
        tradeId: trade.id,
        assignmentId: assignment.id,
        shiftId: assignment.shiftId,
        eventId: assignment.shift.shiftGroup.event.id,
      });
      await notify(assignment.userId, "trade_posted", title, body, `trade_posted_for_${trade.id}`, payload);
      pushJobs.push({ userId: assignment.userId, title, body, payload });
      emailJobs.push({
        userId: assignment.userId,
        title,
        body,
        eventSummary,
        area: assignment.shift.area,
      });
    }

    return trade;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

/**
 * Claim an open trade. The claim is a request: it holds the post and waits for
 * a staff approve/decline. The poster keeps the assignment until `approveTrade`
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
                    event: { select: { summary: true } },
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
    const window = effectiveAssignmentWindow(trade.shiftAssignment);
    assertShiftNotStarted(window.startsAt);
    await checkTimeConflict(tx, userId, window.startsAt, window.endsAt);

    // Validate claimant's primary area matches the shift area
    const claimant = await tx.user.findUnique({
      where: { id: userId },
      select: {
        primaryArea: true,
        role: true,
        staffingType: true,
        active: true,
        areaAssignments: { select: { area: true } },
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    });
    if (!claimant) throw new HttpError(404, "User not found");
    const eligibilityReason = tradeClaimEligibilityReason(claimant, shift);
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

    // The swap itself waits for staff. Until they approve, the poster keeps the
    // assignment: a claim is a request to be released, not the release.
    const claimed = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        claimedByUserId: userId,
        claimedAt: new Date(),
        status: "CLAIMED",
      },
      include: {
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
      },
    });

    const claimerName = claimed.claimedBy?.name ?? "Someone";
    const payload = scheduleNotificationPayload({
      tradeId,
      assignmentId: claimed.shiftAssignment.id,
      shiftId: claimed.shiftAssignment.shift.id,
      eventId: claimed.shiftAssignment.shift.shiftGroup.event.id,
    });

    // Poster: someone wants it, but they are still on the hook until staff act.
    // Saying only "claimed" is how a person stops showing up for a shift they
    // still hold.
    const posterTitle = "Your trade was claimed";
    const posterBody = `${claimerName} claimed your ${shift.area} shift for ${eventSummary}. You're still scheduled until staff approve the trade.`;
    await notify(
      trade.postedByUserId,
      "trade_claimed",
      posterTitle,
      posterBody,
      `trade_claimed_${tradeId}`,
      payload,
    );
    pushJobs.push({ userId: trade.postedByUserId, title: posterTitle, body: posterBody, payload });
    emailJobs.push({
      userId: trade.postedByUserId,
      title: posterTitle,
      body: posterBody,
      eventSummary,
      area: shift.area,
    });

    // Claimer: say plainly that they are not on the schedule yet.
    const claimerTitle = "Claim sent for approval";
    const claimerBody = `Your claim on the ${shift.area} shift for ${eventSummary} is waiting for staff approval. You're not on the schedule until it's approved.`;
    await notify(
      userId,
      "trade_claim_pending",
      claimerTitle,
      claimerBody,
      `trade_claim_pending_${tradeId}`,
      payload,
    );
    pushJobs.push({ userId, title: claimerTitle, body: claimerBody, payload });

    reviewJobs.push({
      tradeId,
      title: "Trade claim needs review",
      body: `${claimerName} claimed ${claimed.postedBy?.name ?? "a teammate"}'s ${shift.area} shift for ${eventSummary}.`,
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
  });
  return result;
}

/**
 * Staff approves a claimed trade → executes swap.
 */
export async function approveTrade(tradeId: string, actor: TradeApprovalActor = null) {
  const emailJobs: ShiftTradeEmail[] = [];
  const pushJobs: TradePushJob[] = [];
  const badgeJobs: Array<Parameters<typeof badges.onTradeCompleted>[0]> = [];

  const result = await db.$transaction(async (tx) => {
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
                    event: { select: { id: true, summary: true } },
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
      throw new HttpError(400, "Only claimed trades can be approved");
    }
    if (!trade.claimedByUserId) {
      throw new HttpError(400, "Trade has no claimer");
    }
    assertNoWorkingCopy(trade.shiftAssignment.shift.shiftGroup?.workingCopy);
    assertShiftNotStarted(effectiveAssignmentWindow(trade.shiftAssignment).startsAt);

    await executeSwap(tx, trade.shiftAssignment.id, trade.claimedByUserId, actor?.id ?? null);

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: { resolvedAt: new Date(), status: "COMPLETED" },
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
    const body = `Your trade for ${area} at ${eventSummary} was approved. You're on the schedule.`;
    const payload = scheduleNotificationPayload({
      tradeId,
      assignmentId: trade.shiftAssignment.id,
      shiftId: trade.shiftAssignment.shift.id,
      eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
    });

    // Notify claimer: swap is confirmed
    await notify(
      trade.claimedByUserId,
      "trade_approved",
      title,
      body,
      `trade_approved_${tradeId}`,
      payload,
    );
    pushJobs.push({
      userId: trade.claimedByUserId,
      title,
      body,
      payload,
    });
    emailJobs.push({
      userId: trade.claimedByUserId,
      title,
      body,
      eventSummary,
      area,
    });

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await Promise.all(badgeJobs.map((event) => badges.onTradeCompleted(event)));
  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

/**
 * Staff declines a claimed trade → back to OPEN.
 */
export async function declineTrade(tradeId: string) {
  const emailJobs: ShiftTradeEmail[] = [];
  const pushJobs: TradePushJob[] = [];

  const result = await db.$transaction(async (tx) => {
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
      throw new HttpError(400, "Only claimed trades can be declined");
    }

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        claimedByUserId: null,
        claimedAt: null,
        status: "OPEN",
      },
    });

    // Notify claimer: declined, trade is back open
    if (trade.claimedByUserId) {
      const area = trade.shiftAssignment.shift.area;
      const eventSummary = trade.shiftAssignment.shift.shiftGroup?.event?.summary ?? "the event";
      const title = "Trade claim declined";
      const body = `Your claim for ${area} at ${eventSummary} was declined. The shift is back on the trade board.`;
      const payload = scheduleNotificationPayload({
        tradeId,
        assignmentId: trade.shiftAssignment.id,
        shiftId: trade.shiftAssignment.shift.id,
        eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
      });

      await notify(
        trade.claimedByUserId,
        "trade_declined",
        title,
        body,
        `trade_declined_${tradeId}_${Date.now()}`,
        payload,
      );
      pushJobs.push({
        userId: trade.claimedByUserId,
        title,
        body,
        payload,
      });
      emailJobs.push({
        userId: trade.claimedByUserId,
        title,
        body,
        eventSummary,
        area,
      });
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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

  const result = await db.$transaction(async (tx) => {
    const trade = await tx.shiftTrade.findUnique({ where: { id: tradeId } });
    if (!trade) throw new HttpError(404, "Trade not found");
    const isPoster = trade.postedByUserId === actor.id;
    if (!isPoster && !isTradeManager(actor)) {
      throw new HttpError(403, "You can only cancel your own trades");
    }
    if (trade.status !== "OPEN" && trade.status !== "CLAIMED") {
      throw new HttpError(400, "Trade cannot be cancelled in its current state");
    }

    const updated = await tx.shiftTrade.update({
      where: { id: tradeId },
      data: {
        resolvedAt: new Date(),
        status: "CANCELLED",
      },
      // Same relation shape as postTrade/claimTrade — clients decode all
      // trade mutations into one model, so a bare row breaks them.
      include: {
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
      },
    });

    if (!isPoster) {
      const shift = updated.shiftAssignment.shift;
      const eventSummary = shift.shiftGroup?.event?.summary ?? "an event";
      const title = "Removed from the Trade Board";
      const body = `Staff removed your ${shift.area} shift for ${eventSummary} from the Trade Board. You're still scheduled for it.`;
      const payload = scheduleNotificationPayload({
        tradeId,
        assignmentId: updated.shiftAssignment.id,
        shiftId: shift.id,
        eventId: shift.shiftGroup.event.id,
      });
      await notify(trade.postedByUserId, "trade_cancelled", title, body, `trade_cancelled_by_staff_${tradeId}`, payload);
      pushJobs.push({ userId: trade.postedByUserId, title, body, payload });
      emailJobs.push({
        userId: trade.postedByUserId,
        title,
        body,
        eventSummary,
        area: shift.area,
      });
    }

    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await dispatchTradeSideEffects({ pushJobs, emailJobs });
  return result;
}

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
  if (filters.status) where.status = filters.status;
  if (filters.area) {
    and.push({ shiftAssignment: { shift: { area: filters.area as ShiftArea } } });
  }
  const actionableStatuses: ShiftTradeStatus[] = ["OPEN", "CLAIMED"];
  const now = new Date();
  if (filters.status && actionableStatuses.includes(filters.status)) {
    and.push({ shiftAssignment: futureEffectiveAssignmentWhere(now) });
  } else if (!filters.status) {
    and.push({
      OR: [
        { status: { notIn: actionableStatuses } },
        { shiftAssignment: futureEffectiveAssignmentWhere(now) },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const data = await db.shiftTrade.findMany({
    where,
    take: filters.limit,
    skip: filters.offset,
    include: {
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
                      sportCode: true,
                      opponent: true,
                      isHome: true,
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
    },
    orderBy: { postedAt: "desc" },
  });
  const total = await db.shiftTrade.count({ where });
  const availabilityUserIds = new Set<string>();
  if (filters.userId) availabilityUserIds.add(filters.userId);
  for (const trade of data) {
    if (trade.status === "CLAIMED" && trade.claimedByUserId) {
      availabilityUserIds.add(trade.claimedByUserId);
    }
  }
  const availabilityUsers = availabilityUserIds.size > 0
    ? await db.user.findMany({
      where: { id: { in: [...availabilityUserIds] } },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        primaryArea: true,
        areaAssignments: { select: { area: true } },
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    })
    : [];
  const usersById = new Map(availabilityUsers.map((user) => [user.id, user]));
  const viewer = filters.userId ? usersById.get(filters.userId) ?? null : null;
  const viewerBlocks = viewer?.availabilityBlocks ?? [];

  return {
    data: data.map((trade) => {
      const window = effectiveAssignmentWindow(trade.shiftAssignment);
      const viewerAvailabilityContext = filters.userId && trade.postedByUserId !== filters.userId
        ? availabilityContextFromBlocks(viewerBlocks, window)
        : null;
      const claimedByAvailabilityContext = trade.claimedByUserId
        ? availabilityContextFromBlocks(usersById.get(trade.claimedByUserId)?.availabilityBlocks ?? [], window)
        : null;
      const viewerEligibilityReason = viewer
        ? tradeClaimEligibilityReason(viewer, trade.shiftAssignment.shift)
        : null;
      let viewerCanClaim = false;
      let viewerClaimReason: string | null = null;
      if (trade.status === "CLAIMED") {
        // "Not open" is true but useless here. Whoever is looking is either the
        // person waiting on the decision or the person who has to make it.
        viewerClaimReason = trade.claimedByUserId === filters.userId
          ? "Waiting for staff to approve your claim"
          : trade.postedByUserId === filters.userId
            ? `${trade.claimedBy?.name ?? "Someone"} claimed this — waiting for staff approval`
            : "Claimed and waiting for staff approval";
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
      };
    }),
    total,
  };
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

  // Notify posters (best-effort, skip duplicates)
  if (staleTrades.length > 0) {
    await db.notification.createMany({
      data: staleTrades.map((t) => ({
        userId: t.postedByUserId,
        type: "trade_expired",
        title: "Trade expired",
        body: `Your trade for ${t.shiftAssignment.shift.area} at ${
          t.shiftAssignment.shift.shiftGroup?.event?.summary ?? "the event"
        } expired — the shift has passed.`,
        payload: JSON.parse(JSON.stringify(scheduleNotificationPayload({
          tradeId: t.id,
          eventId: t.shiftAssignment.shift.shiftGroup.event.id,
        }))),
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `trade_expired_${t.id}`,
      })),
      skipDuplicates: true,
    });
  }

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
      areaAssignments: { select: { area: true } },
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
  const eligibilityReason = tradeClaimEligibilityReason(claimer, assignment.shift);
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
