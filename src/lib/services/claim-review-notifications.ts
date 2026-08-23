import { db } from "@/lib/db";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { sendPushToUser } from "@/lib/services/notifications";
import {
  categoryForScheduleNotificationType,
  scheduleNotificationPayload,
} from "@/lib/services/schedule-notification-policy";
import type { PendingClaimKind } from "@/workflows/pending-claim-review";

type ClaimContext = {
  area: string;
  eventId: string;
  eventSummary: string;
  shiftId: string | null;
  assignmentId: string | null;
  claimantName: string;
};

async function loadTradeContext(tradeId: string): Promise<ClaimContext | null> {
  const trade = await db.shiftTrade.findUnique({
    where: { id: tradeId },
    select: {
      claimedBy: { select: { name: true } },
      shiftAssignment: {
        select: {
          id: true,
          shiftId: true,
          shift: {
            select: {
              area: true,
              shiftGroup: { select: { event: { select: { id: true, summary: true } } } },
            },
          },
        },
      },
    },
  });
  if (!trade) return null;
  return {
    area: trade.shiftAssignment.shift.area,
    eventId: trade.shiftAssignment.shift.shiftGroup.event.id,
    eventSummary: trade.shiftAssignment.shift.shiftGroup.event.summary,
    shiftId: trade.shiftAssignment.shiftId,
    assignmentId: trade.shiftAssignment.id,
    claimantName: trade.claimedBy?.name ?? "Someone",
  };
}

async function loadRequestContext(assignmentId: string): Promise<ClaimContext | null> {
  const assignment = await db.shiftAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      shiftId: true,
      user: { select: { name: true } },
      shift: {
        select: {
          area: true,
          shiftGroup: { select: { event: { select: { id: true, summary: true } } } },
        },
      },
    },
  });
  if (!assignment) return null;
  return {
    area: assignment.shift.area,
    eventId: assignment.shift.shiftGroup.event.id,
    eventSummary: assignment.shift.shiftGroup.event.summary,
    shiftId: assignment.shiftId,
    assignmentId: assignment.id,
    claimantName: assignment.user.name,
  };
}

function loadContext(kind: PendingClaimKind, claimId: string) {
  return kind === "trade" ? loadTradeContext(claimId) : loadRequestContext(claimId);
}

async function notifyReviewers(args: {
  claimId: string;
  context: ClaimContext;
  type: string;
  title: string;
  body: string;
}) {
  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const payload = scheduleNotificationPayload({
    eventId: args.context.eventId,
    shiftId: args.context.shiftId,
    assignmentId: args.context.assignmentId,
  });
  const now = new Date();

  try {
    await db.notification.createMany({
      data: reviewers.map((reviewer) => ({
        userId: reviewer.id,
        type: args.type,
        title: args.title,
        body: args.body,
        payload: JSON.parse(JSON.stringify(payload)),
        channel: "IN_APP" as const,
        sentAt: now,
        dedupeKey: `${args.type}_${args.claimId}_${reviewer.id}`,
      })),
      skipDuplicates: true,
    });

    await Promise.allSettled(reviewers.map((reviewer) =>
      sendPushToUser(reviewer.id, {
        title: args.title,
        body: args.body,
        payload,
        // Derived, not hardcoded, so this stays honest if the mapping changes.
        category: categoryForScheduleNotificationType(args.type) ?? "schedule",
      }),
    ));
  } catch (err) {
    console.error(`[NOTIFY] Failed to notify reviewers about claim ${args.claimId}:`, err);
  }
}

/**
 * A claim has waited long enough that the shift is approaching. Say plainly
 * what happens if nobody acts, so the escalation is actionable rather than
 * another line in the inbox.
 */
export async function escalatePendingClaim(kind: PendingClaimKind, claimId: string): Promise<void> {
  const context = await loadContext(kind, claimId);
  if (!context) return;

  const what = kind === "trade" ? "trade claim" : "shift request";
  await notifyReviewers({
    claimId,
    context,
    type: "claim_review_escalated",
    title: `${kind === "trade" ? "Trade" : "Shift"} claim still needs review`,
    body: `${context.claimantName}'s ${what} for the ${context.area} slot at ${context.eventSummary} is still waiting. It will be approved automatically if nobody reviews it.`,
  });
}

/**
 * Report what the deadline did. An auto-approval that nobody is told about is a
 * schedule change staff did not make and cannot see.
 */
export async function reportPendingClaimAutoApproval(
  kind: PendingClaimKind,
  claimId: string,
  blockedReason: string | null,
): Promise<void> {
  const context = await loadContext(kind, claimId);
  if (!context) return;

  const what = kind === "trade" ? "trade claim" : "shift request";
  if (blockedReason) {
    await notifyReviewers({
      claimId,
      context,
      type: "claim_review_blocked",
      title: "Claim could not be approved automatically",
      body: `${context.claimantName}'s ${what} for the ${context.area} slot at ${context.eventSummary} could not be approved: ${blockedReason} It still needs a decision.`,
    });
    return;
  }

  await notifyReviewers({
    claimId,
    context,
    type: "claim_review_auto_approved",
    title: "Claim approved automatically",
    body: `${context.claimantName}'s ${what} for the ${context.area} slot at ${context.eventSummary} was approved automatically because it reached its review deadline.`,
  });
}
