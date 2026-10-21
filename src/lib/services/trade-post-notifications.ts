import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { claimableShiftAreas, shiftClaimEligibilityReason } from "@/lib/shift-claim-eligibility";
import { sendPushToUser } from "@/lib/services/notifications";
import { scheduleNotificationPayload } from "@/lib/services/schedule-notification-policy";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/**
 * Tell students who could take a newly posted shift that it is on the board.
 * A post nobody hears about sits until the shift starts and expires, so the
 * board only works if the people who can claim it are told.
 *
 * Runs after the post commits and never throws: the post already happened.
 * Only eligible students are told (same area pool, matching slot class, not
 * the poster, not already working an overlapping shift), and the per-user
 * dedupe key makes a retried request a no-op. Delivery honors each person's
 * Trade updates preference and quiet hours through the normal push path.
 */
export async function notifyEligibleStudentsOfTradePost(tradeId: string): Promise<number> {
  try {
    const trade = await db.shiftTrade.findUnique({
      where: { id: tradeId },
      select: {
        id: true,
        status: true,
        postedByUserId: true,
        shiftAssignment: {
          select: {
            shift: {
              select: {
                id: true,
                area: true,
                workerType: true,
                startsAt: true,
                endsAt: true,
                shiftGroup: { select: { event: { select: { id: true, summary: true } } } },
              },
            },
          },
        },
      },
    });
    if (!trade || trade.status !== "OPEN") return 0;

    const shift = trade.shiftAssignment.shift;
    const areas = claimableShiftAreas(shift.area);
    // Anyone whose primary area can claim this shift's area. The pool is symmetric
    // (Photo and Graphics share one), so asking for the shift area's own pool is enough.
    const candidates = await db.user.findMany({
      where: visibleActiveUserWhere({
        id: { not: trade.postedByUserId },
        role: "STUDENT",
        primaryArea: { in: areas },
        // Not already working something that overlaps; a claim would be refused.
        shiftAssignments: {
          none: {
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            shift: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
          },
        },
      } satisfies Prisma.UserWhereInput),
      select: { id: true, active: true, role: true, staffingType: true, primaryArea: true },
    });

    const eligible = candidates.filter((user) =>
      shiftClaimEligibilityReason(
        { active: user.active, role: user.role, staffingType: user.staffingType, primaryArea: user.primaryArea },
        shift,
      ) === null,
    );
    if (eligible.length === 0) return 0;

    const event = shift.shiftGroup.event;
    const title = "A shift is up for trade";
    const body = `A ${shift.area.toLowerCase().replace("_", " ")} shift at ${event.summary} was posted to the Trade Board. Claim it if you can take it.`;
    const payload = scheduleNotificationPayload({
      tradeId: trade.id,
      shiftId: shift.id,
      eventId: event.id,
      extra: { href: "/schedule?tradeBoard=1" },
    });

    const created = await db.notification.createManyAndReturn({
      data: eligible.map((user) => ({
        userId: user.id,
        type: "trade_available",
        title,
        body,
        payload: payload as Prisma.InputJsonValue,
        channel: "IN_APP" as const,
        sentAt: new Date(),
        dedupeKey: `trade_available_${trade.id}_${user.id}`,
      })),
      skipDuplicates: true,
      select: { id: true, userId: true },
    });

    await Promise.allSettled(created.map((row) =>
      sendPushToUser(row.userId, {
        title,
        subtitle: event.summary,
        body: "Open it on the Trade Board to claim.",
        payload,
        category: "trade",
        notificationId: row.id,
      }),
    ));
    return created.length;
  } catch (err) {
    console.error("[TRADES] Failed to notify eligible students of a post:", err);
    return 0;
  }
}
