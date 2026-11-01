// What workers do on the Trade Board: post a shift, claim one, withdraw a claim.

import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { type ShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { scheduleNotificationPayload } from "@/lib/services/schedule-notification-policy";
import { availabilityContextFromBlocks } from "@/lib/schedule-availability-context";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { withSerializationRetry } from "@/lib/serialization";
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { enqueuePendingClaimReview } from "@/lib/claim-review-workflow";
import { createAuditEntryTx } from "@/lib/audit";
import { shiftClaimEligibilityReason } from "@/lib/shift-claim-eligibility";
import {
  assertShiftNotStarted,
  effectiveAssignmentWindow,
  tradeResponseInclude,
  tradeEventStateSelect,
  assertTradeEventLive,
  availabilityBlockSelect,
  writeTradeNotification,
  notifyAfterCommit,
  type TradeActor,
  type TradePushJob,
  type TradeReviewJob,
  dispatchTradeSideEffects,
  notifyTradeReviewers,
  isTradeManager,
} from "./shift-trades-shared";

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
                event: { select: { id: true, summary: true, ...tradeEventStateSelect } },
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
    assertTradeEventLive(assignment.shift.shiftGroup);
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
          href: payload.href,
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
        href: payload.href,
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
