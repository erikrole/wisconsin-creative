import { BookingCustodyScope, BookingKind, BookingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { appTzDateKey } from "@/lib/app-time";
import { createAuditEntry, createSystemAuditEntry } from "@/lib/audit";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { requireKioskActor } from "@/lib/services/kiosk-actor";

/**
 * One kiosk nudge per booking per app-timezone calendar day (Erik, 2026-09-25:
 * anyone at the kiosk may nudge an overdue checkout, once per day). The key is
 * a unique `Notification.dedupeKey`, so the database decides the race.
 */
export function kioskNudgeDedupeKey(bookingId: string, now: Date = new Date()) {
  return `kiosk-nudge-${bookingId}-${appTzDateKey(now)}`;
}

export function overdueForLabel(endsAt: Date, now: Date) {
  const hours = Math.max(1, Math.floor((now.getTime() - endsAt.getTime()) / 3_600_000));
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function kioskNudgeCopy(title: string, endsAt: Date, now: Date) {
  return {
    title: `Someone's looking for your ${title}`,
    body: `It's ${overdueForLabel(endsAt, now)} overdue and someone at the kiosk needs it. Please bring it back.`,
  };
}

/** Which of these bookings were already nudged from a kiosk today. */
export async function kioskNudgedTodaySet(bookingIds: string[], now: Date = new Date()) {
  if (bookingIds.length === 0) return new Set<string>();
  const keyToBooking = new Map(bookingIds.map((id) => [kioskNudgeDedupeKey(id, now), id]));
  const rows = await db.notification.findMany({
    where: { dedupeKey: { in: [...keyToBooking.keys()] } },
    select: { dedupeKey: true },
  });
  return new Set(rows.map((row) => keyToBooking.get(row.dedupeKey ?? "")).filter((id): id is string => Boolean(id)));
}

export async function sendKioskNudge(args: {
  bookingId: string;
  actorId?: string;
  kioskId: string;
  now?: Date;
}): Promise<{ success: true; alreadyNudged?: true }> {
  const now = args.now ?? new Date();
  const actor = args.actorId ? await requireKioskActor(db, args.actorId) : null;

  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: { id: true, kind: true, status: true, custodyScope: true, endsAt: true, title: true, requesterUserId: true },
  });
  if (!booking || booking.kind !== BookingKind.CHECKOUT) throw new HttpError(404, "Checkout not found");
  if (booking.status !== BookingStatus.OPEN) throw new HttpError(409, "This checkout is no longer out.", { code: "not_open" });
  if (booking.custodyScope === BookingCustodyScope.SHARED) {
    throw new HttpError(409, "Shared gear can't be nudged. It isn't one person's.", { code: "shared_custody" });
  }
  // Same overdue rule the kiosk home shows (`isOverdue: endsAt < now`).
  if (booking.endsAt >= now) throw new HttpError(409, "This checkout isn't overdue yet.", { code: "not_overdue" });

  const title = displayBookingTitle(booking.title);
  const copy = kioskNudgeCopy(title, booking.endsAt, now);
  const payload = { bookingId: booking.id, href: `/checkouts/${booking.id}` };
  const [row] = await db.notification.createManyAndReturn({
    data: [{
      userId: booking.requesterUserId,
      bookingId: booking.id,
      type: "overdue_nudge",
      title: copy.title,
      body: copy.body,
      payload,
      channel: "IN_APP",
      sentAt: now,
      dedupeKey: kioskNudgeDedupeKey(booking.id, now),
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  if (!row) return { success: true, alreadyNudged: true };

  deferPush(sendPushToUser(booking.requesterUserId, {
    title: copy.title,
    body: copy.body,
    payload,
    category: "checkoutOverdue",
    notificationId: row.id,
    // Shares the checkout's slot, replacing its latest reminder.
    collapseId: `checkout-${booking.id}`,
  }));

  const after = {
    source: "KIOSK",
    kioskDeviceId: args.kioskId,
    requesterUserId: booking.requesterUserId,
    endsAt: booking.endsAt.toISOString(),
    notificationId: row.id,
  };
  if (actor) {
    await createAuditEntry({
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_overdue_nudge_sent",
      before: { nudgedToday: false },
      after: { ...after, nudgedToday: true },
    });
  } else {
    await createSystemAuditEntry({
      entityType: "booking",
      entityId: booking.id,
      action: "kiosk_overdue_nudge_sent",
      before: { nudgedToday: false },
      after: { ...after, nudgedToday: true },
    });
  }
  return { success: true };
}
