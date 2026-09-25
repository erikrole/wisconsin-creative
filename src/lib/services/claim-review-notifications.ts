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
  /** Set for trade claims, so a lock-screen Approve targets the trade, not the assignment. */
  tradeId?: string;
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
    tradeId,
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
  /** Push body under the event-name subtitle. */
  pushBody: string;
  /** Override for alerts with nothing left to decide. */
  apnsCategory?: "GT_ALERT";
}) {
  const reviewers = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (reviewers.length === 0) return;

  const payload = scheduleNotificationPayload({
    eventId: args.context.eventId,
    shiftId: args.context.shiftId,
    assignmentId: args.context.assignmentId,
    tradeId: args.context.tradeId,
  });
  const now = new Date();

  try {
    // Only reviewers whose row is new get a push, so a retried step stays silent.
    const created = await db.notification.createManyAndReturn({
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
      select: { id: true, userId: true },
    });

    await Promise.allSettled(created.map((row) =>
      sendPushToUser(row.userId, {
        title: args.title,
        subtitle: args.context.eventSummary,
        body: args.pushBody,
        notificationId: row.id,
        apnsCategory: args.apnsCategory,
        payload,
        // Derived, not hardcoded, so this stays honest if the mapping changes.
        category: categoryForScheduleNotificationType(args.type) ?? "reviewQueue",
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
    title: kind === "trade" ? "Trade claim still needs review" : "Shift request still needs review",
    body: `${context.claimantName}'s ${what} for the ${context.area} shift at ${context.eventSummary} is still waiting. It will be approved automatically if nobody reviews it.`,
    pushBody: `${context.claimantName} wants the ${context.area} shift. It's approved automatically if no one reviews it.`,
  });
}

/**
 * Report what the deadline did. An auto-approval that nobody is told about is a
 * schedule change reviewers did not make and cannot see.
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
      title: "Couldn't approve automatically",
      body: `${context.claimantName}'s ${what} for the ${context.area} shift at ${context.eventSummary} couldn't be approved: ${blockedReason} It still needs a decision.`,
      pushBody: `${context.claimantName} wants the ${context.area} shift. ${blockedReason} Review it in the app.`,
    });
    return;
  }

  await notifyReviewers({
    claimId,
    context,
    type: "claim_review_auto_approved",
    title: "Approved automatically",
    body: `${context.claimantName}'s ${what} for the ${context.area} shift at ${context.eventSummary} was approved automatically at its review deadline.`,
    pushBody: `${context.claimantName} is on the ${context.area} shift. No one reviewed it before the deadline.`,
    // Already decided: offer Mark as Read, not Approve/Decline.
    apnsCategory: "GT_ALERT",
  });
}
