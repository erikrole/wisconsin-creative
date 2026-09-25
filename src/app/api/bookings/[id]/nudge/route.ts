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
  // Counted from the due time, like the automatic "4 hours overdue" stages.
  const hours = Math.max(1, Math.round((Date.now() - booking.endsAt.getTime()) / 3_600_000));
  const overdueFor = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const title = "Please return your gear";
  const body = `"${booking.title}" is ${overdueFor} overdue. Staff asked you to return it.`;
  const pushBody = `It's ${overdueFor} overdue.`;
  const payload = { bookingId: booking.id, href: `/checkouts/${booking.id}` };
  // One nudge per booking per UTC hour. A second tap in the same hour is a
  // no-op success rather than a unique-key 409: the student already has it.
  const [rows, requester] = await Promise.all([
    db.notification.createManyAndReturn({
      data: [{
        userId: booking.requesterUserId,
        bookingId: booking.id,
        type: "overdue_nudge",
        title,
        body,
        payload,
        channel: "IN_APP",
        sentAt: new Date(),
        dedupeKey: `nudge-${booking.id}-${new Date().toISOString().slice(0, 13)}`,
      }],
      skipDuplicates: true,
      select: { id: true },
    }),
    db.user.findUnique({ where: { id: booking.requesterUserId }, select: { name: true } }),
  ]);
  const [row] = rows;
  if (!row) return ok({ success: true, alreadyNudged: true });

  deferPush(sendPushToUser(booking.requesterUserId, {
    title,
    subtitle: booking.title,
    body: pushBody,
    payload,
    category: "checkoutOverdue",
    notificationId: row.id,
    // Shares the checkout's slot, replacing its latest reminder.
    collapseId: `checkout-${booking.id}`,
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
