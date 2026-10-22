import { db } from "@/lib/db";
import { formatAppDateTime } from "@/lib/app-time";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";

type Person = { id: string; name: string };

export type GearHandover = {
  /** Who pressed the button. Staff moving someone else's gear is not either party. */
  actor: Person;
  /** Checkout or booking the gear left. Equals receivingId when only the owner changed. */
  sourceId: string;
  receivingId: string;
  /** Distinguishes repeat handovers between the same two bookings. */
  stamp: number;
  title: string;
  endsAt: Date;
  from: Person | null;
  to: Person;
  /** 0 means the whole booking changed hands rather than selected items. */
  itemCount: number;
  sourceClosed: boolean;
  /** Reservations are not "due"; only checkouts get the due line. */
  isCheckout: boolean;
};

export function gearHandoverCopy(h: GearHandover) {
  const actorIsFrom = h.from?.id === h.actor.id;
  const fromName = h.from?.name ?? "Someone";
  const moved = h.itemCount > 0 && !h.sourceClosed;
  return {
    toNewHolder: {
      title: `${actorIsFrom ? fromName : h.actor.name} handed you ${h.title}`,
      body: h.isCheckout
        ? `It's on your record now. It's due ${formatAppDateTime(h.endsAt)}.`
        : "It's on your bookings now.",
    },
    toOldHolder: {
      title: actorIsFrom
        ? `You handed ${h.title} to ${h.to.name}`
        : `${h.actor.name} moved ${h.title} to ${h.to.name}`,
      body: moved
        ? `${h.itemCount} ${h.itemCount === 1 ? "item is" : "items are"} off your record now. The rest is still with you.`
        : "It's off your record now.",
    },
  };
}

/**
 * Tells the new holder (push + inbox) and the old holder (inbox, plus a push
 * when someone else moved their gear). The person who made the change gets a
 * read receipt instead of a buzz. Delivery never fails the transfer.
 */
export async function notifyGearHandover(h: GearHandover) {
  const copy = gearHandoverCopy(h);
  const messages = [
    h.to.id !== h.actor.id
      ? { userId: h.to.id, bookingId: h.receivingId, key: "in", receipt: false, ...copy.toNewHolder }
      : null,
    h.from && h.from.id !== h.to.id
      ? { userId: h.from.id, bookingId: h.sourceId, key: "out", receipt: h.from.id === h.actor.id, ...copy.toOldHolder }
      : null,
  ].filter((m): m is NonNullable<typeof m> => m !== null);
  if (!messages.length) return;
  const now = new Date();
  try {
    const rows = await db.notification.createManyAndReturn({
      data: messages.map((m) => ({
        userId: m.userId,
        bookingId: m.bookingId,
        type: "kiosk_checkout_handover",
        title: m.title,
        body: m.body,
        payload: { bookingId: m.bookingId, href: `/checkouts/${m.bookingId}` },
        channel: "IN_APP" as const,
        sentAt: now,
        readAt: m.receipt ? now : null,
        dedupeKey: `kiosk-handover-${h.sourceId}-${h.receivingId}-${h.stamp}-${m.key}`,
      })),
      skipDuplicates: true,
      select: { id: true, userId: true },
    });
    for (const row of rows) {
      const message = messages.find((m) => m.userId === row.userId);
      if (!message || message.receipt) continue;
      deferPush(sendPushToUser(message.userId, {
        title: message.title,
        body: message.body,
        payload: { bookingId: message.bookingId, href: `/checkouts/${message.bookingId}` },
        category: "checkoutDue",
        notificationId: row.id,
      }));
    }
  } catch (error) {
    console.error("[gear-handover] notification failed", error);
  }
}
