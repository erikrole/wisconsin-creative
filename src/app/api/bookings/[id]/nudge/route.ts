import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { createAuditEntry } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";

const NUDGE_LIMIT = { max: 30, windowMs: 60_000 };

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { allowed } = await checkRateLimit(`nudge:${user.id}`, NUDGE_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many nudges. Please wait a moment.");

  // requireBookingAction checks: staff+ role, OPEN status, CHECKOUT kind
  const booking = await requireBookingAction(params.id, user, "nudge");

  const policies = await loadCheckoutPolicies();
  const overdueAt = new Date(booking.endsAt.getTime() + policies.gracePeriodHours * 3_600_000);
  const isOverdue = overdueAt <= new Date();
  if (!isOverdue) {
    throw new HttpError(400, "Booking is still within its return grace period");
  }

  // Create in-app notification for the requester
  const hours = Math.max(0, Math.round((Date.now() - overdueAt.getTime()) / 3_600_000));
  const title = "Overdue gear reminder";
  const body = `"${booking.title}" is ${hours}h overdue. Please return the gear.`;
  const [, requester] = await Promise.all([
    db.notification.create({
      data: {
        userId: booking.requesterUserId,
        bookingId: booking.id,
        type: "overdue_nudge",
        title,
        body,
        payload: { bookingId: booking.id },
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey: `nudge-${booking.id}-${new Date().toISOString().slice(0, 13)}`,
      },
    }),
    db.user.findUnique({ where: { id: booking.requesterUserId }, select: { name: true } }),
  ]);

  deferPush(sendPushToUser(booking.requesterUserId, {
    title,
    body,
    payload: { bookingId: booking.id },
    category: "checkoutOverdue",
  }));

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "booking",
    entityId: booking.id,
    action: "overdue_nudge_sent",
    after: { requester: requester?.name ?? booking.requesterUserId, overdueHours: hours },
  });

  return ok({ success: true });
});
