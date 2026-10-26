import { db } from "@/lib/db";
import { buildNotificationEmail } from "@/lib/email";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { deferPush, sendPushToUser, sendEmailToUser } from "./notification-delivery";

type ReservationLifecycleEvent = "booked" | "updated" | "pickup_ready" | "cancelled";

/**
 * Sends an in-app notification to the requester for reservation lifecycle events.
 * For "cancelled", skips the notification if the actor is the requester (self-cancel).
 * When the requester did it themselves, the row is a read receipt and nothing is pushed.
 * "updated" can happen many times, so callers pass the booking's `updatedAt`
 * as `version` to give each update its own row.
 */
export async function createReservationLifecycleNotification(args: {
  bookingId: string;
  bookingTitle: string;
  requesterUserId: string;
  actorUserId: string;
  event: ReservationLifecycleEvent;
  version?: Date;
}): Promise<void> {
  const { bookingId, requesterUserId, actorUserId, event, version } = args;
  const bookingTitle = args.bookingTitle ? displayBookingTitle(args.bookingTitle) : "";

  // Don't notify users when they cancel their own reservation
  if (event === "cancelled" && requesterUserId === actorUserId) return;

  const dedupeKey = version
    ? `${bookingId}:reservation_${event}:${version.toISOString()}`
    : `${bookingId}:reservation_${event}`;

  const configs: Record<ReservationLifecycleEvent, { type: string; title: string; body: string; pushBody: string }> = {
    booked: {
      type: "reservation_booked",
      title: "Reservation confirmed",
      body: `Your reservation "${bookingTitle}" is confirmed.`,
      pushBody: "Staff made this reservation for you.",
    },
    updated: {
      type: "reservation_updated",
      title: "Gear added to your reservation",
      body: `More gear was added to your "${bookingTitle}" reservation.`,
      pushBody: "Tap to see the updated gear list.",
    },
    pickup_ready: {
      type: "reservation_pickup_ready",
      title: "Ready for pickup",
      body: `Your "${bookingTitle}" gear is ready. Pick it up at the kiosk.`,
      pushBody: "Pick it up at the kiosk.",
    },
    cancelled: {
      type: "reservation_cancelled",
      title: "Reservation cancelled",
      body: `Your reservation "${bookingTitle}" was cancelled. The gear is no longer held.`,
      pushBody: "Your gear is no longer held.",
    },
  };

  const { type, title, body, pushBody } = configs[event];
  // Something the person just did themselves is a receipt, not news: keep the
  // row for their history, but don't count it as unread or ping their phone.
  const selfMade = requesterUserId === actorUserId;
  const now = new Date();

  try {
    const [row] = await db.notification.createManyAndReturn({
      data: [{
        userId: requesterUserId,
        bookingId,
        type,
        title,
        body,
        payload: { bookingId, href: `/reservations/${bookingId}` },
        channel: "IN_APP",
        sentAt: now,
        readAt: selfMade ? now : null,
        dedupeKey,
      }],
      skipDuplicates: true,
      select: { id: true },
    });
    if (!row || selfMade) return;

    deferPush(sendPushToUser(requesterUserId, {
      title,
      subtitle: bookingTitle,
      body: pushBody,
      payload: { bookingId, href: `/reservations/${bookingId}` },
      category: "reservation",
      notificationId: row.id,
      collapseId: `reservation-${bookingId}`,
    }));
  } catch (err) {
    console.error(`[NOTIFY] Failed to create reservation_${event} notification for booking ${bookingId}:`, err);
  }
}

/**
 * Notifies all ADMIN and STAFF users when a student reports an item as damaged or lost
 * during check-in scanning.
 */
export async function notifyItemReport(args: {
  /** Absent for a report filed from the item page. */
  bookingId?: string;
  bookingTitle?: string;
  reportId?: string;
  assetId: string;
  assetTag: string;
  itemDescription: string;
  reportType: "DAMAGED" | "LOST";
  damageDescription?: string;
  evidenceImageUrl?: string;
  reporterName: string;
}): Promise<void> {
  const supervisors = await db.user.findMany({
    where: visibleActiveUserWhere({ role: { in: ["ADMIN", "STAFF"] } }),
    select: { id: true, email: true },
  });

  const now = new Date();
  const bookingTitle = args.bookingTitle ? displayBookingTitle(args.bookingTitle) : "";
  const typeLower = args.reportType.toLowerCase();
  const notifType = `checkin_item_${typeLower}`;
  const title = `Item reported ${typeLower}: ${args.assetTag}`;
  const where = args.bookingTitle ? ` during check-in of "${bookingTitle}"` : "";
  const href = args.bookingId ? `/checkouts/${args.bookingId}` : "/damage";
  const body = args.reportType === "DAMAGED"
    ? `${args.reporterName} reported ${args.itemDescription} (${args.assetTag}) as damaged${where}.${args.damageDescription ? ` Description: ${args.damageDescription}` : ""}`
    : `${args.reporterName} reported ${args.itemDescription} (${args.assetTag}) as ${args.bookingTitle ? "lost" : "missing"}${where}.`;

  // Batch-create all notifications in one INSERT
  const notifData = supervisors.map((s) => ({
    userId: s.id,
    bookingId: args.bookingId ?? null,
    type: notifType,
    title,
    body,
    payload: {
      bookingId: args.bookingId,
      bookingTitle,
      assetId: args.assetId,
      assetTag: args.assetTag,
      reportType: args.reportType,
      reporterName: args.reporterName,
      href,
      ...(args.evidenceImageUrl ? { evidenceImageUrl: args.evidenceImageUrl } : {}),
    },
    channel: "IN_APP" as const,
    sentAt: now,
    dedupeKey: `${args.bookingId ?? args.reportId ?? "item"}:item_report:${args.assetId}:${s.id}`,
  }));

  // A repeat report of the same asset on the same booking dedupes to the
  // existing rows; only supervisors with a new row are emailed. If the insert
  // itself fails, email everyone so the report is not lost.
  let recipients = supervisors;
  try {
    const created = await db.notification.createManyAndReturn({
      data: notifData,
      skipDuplicates: true,
      select: { userId: true },
    });
    const createdIds = new Set(created.map((row) => row.userId));
    recipients = supervisors.filter((s) => createdIds.has(s.id));
  } catch (err) {
    console.error(`[NOTIFY] Failed to batch-create item report notifications:`, err);
  }

  // Send emails concurrently (fire-and-forget, failures don't block)
  const emailPromises = recipients
    .filter((s) => s.email)
    .map((s) =>
      sendEmailToUser(s.id, {
        to: s.email!,
        subject: title,
        ...buildNotificationEmail({
          kind: "item",
          title,
          body,
          bookingTitle: args.bookingTitle ? bookingTitle : args.assetTag,
          dueAt: now.toISOString(),
          href,
        }),
      }, "itemReports").catch((err) =>
        console.error(`[NOTIFY] Failed to send item report email to ${s.email}:`, err)
      )
    );
  await Promise.allSettled(emailPromises);
}
