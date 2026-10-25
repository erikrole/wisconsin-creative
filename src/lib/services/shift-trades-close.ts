// Taking a trade off the board: cancellation and the morning expiry sweep.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { type ShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { scheduleNotificationPayload } from "@/lib/services/schedule-notification-policy";
import { withSerializationRetry } from "@/lib/serialization";
import {
  staleEffectiveAssignmentWhere,
  tradeResponseInclude,
  writeTradeNotification,
  type TradeActor,
  type TradePushJob,
  dispatchTradeSideEffects,
  isTradeManager,
} from "./shift-trades-shared";

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
          href: payload.href,
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
          href: payload.href,
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
