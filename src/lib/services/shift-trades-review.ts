// Admin review of a claimed trade: approve (runs the swap) or decline.

import { Prisma, ShiftTradeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { type ShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { scheduleNotificationPayload } from "@/lib/services/schedule-notification-policy";
import { badges } from "@/lib/badges";
import { evaluateAvailabilityPreferences } from "@/lib/student-availability";
import { withSerializationRetry } from "@/lib/serialization";
import { assertNoWorkingCopy } from "@/lib/schedule-working-copy-guard";
import { createAuditEntryTx } from "@/lib/audit";
import { shiftClaimEligibilityReason } from "@/lib/shift-claim-eligibility";
import {
  assertShiftNotStarted,
  effectiveAssignmentWindow,
  tradeResponseInclude,
  tradeEventStateSelect,
  assertTradeEventLive,
  writeTradeNotification,
  type TradeApprovalActor,
  type TradePushJob,
  dispatchTradeSideEffects,
} from "./shift-trades-shared";

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
        href: payload.href,
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
        href: payload.href,
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
          href: payload.href,
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
