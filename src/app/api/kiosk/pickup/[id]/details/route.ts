import { z } from "zod";
import { CalendarEventStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { bookingSnapshotMatches } from "@/lib/booking-concurrency";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { updateBookingEvents, updateBookingEventsTx, updateCheckout, updateReservation } from "@/lib/services/bookings-lifecycle";
import { dispatchScheduleAssignmentNotifications } from "@/lib/services/notifications";
import { assertKioskPickupPlanActor, kioskPickupPlanActorSelect } from "@/lib/services/kiosk-pickup-add";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

const cuidish = z.string().min(1).max(64);

const bodySchema = z.object({
  actorId: cuidish,
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1).max(160).optional(),
  /** Link one of their events (its name becomes the title); null unlinks. */
  eventId: cuidish.nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
}).refine((body) => body.title !== undefined || body.eventId !== undefined || body.endsAt !== undefined, {
  message: "Title, event, or return time is required",
});

/**
 * PATCH /api/kiosk/pickup/[id]/details — before pickup, rename the booking,
 * link it to an event, or move its due-back time from the pickup screen's
 * context card. Works for a BOOKED reservation and a legacy PENDING_PICKUP
 * checkout. Title and time go through `updateReservation` / `updateCheckout`
 * (Serializable, availability-checked with the same rules
 * `GET /api/kiosk/checkout/[id]/extend-window` reports, audited before/after);
 * an event link commits inside that same transaction (`updateBookingEventsTx`),
 * or alone through `updateBookingEvents` when only the link changes. Items and staged pickup scans are not touched.
 */
export const PATCH = withKiosk<{ id: string }>(async (req, { params }) => {
  const body = bodySchema.parse(await req.json());
  const [booking, actor] = await Promise.all([
    db.booking.findUnique({
      where: { id: params.id },
      select: { id: true, kind: true, status: true, custodyScope: true, requesterUserId: true, updatedAt: true },
    }),
    db.user.findFirst({
      where: { id: body.actorId, ...kioskRosterUserWhere() },
      select: kioskPickupPlanActorSelect,
    }),
  ]);
  const isReservation = booking?.kind === "RESERVATION" && booking.status === "BOOKED";
  const isLegacyPickup = booking?.kind === "CHECKOUT" && booking.status === "PENDING_PICKUP";
  if (!booking || (!isReservation && !isLegacyPickup)) throw new HttpError(404, "Pickup not found");
  if (!actor) throw new HttpError(403, "Choose an active operator");
  assertKioskPickupPlanActor(booking, actor);

  const expectedUpdatedAt = new Date(body.expectedUpdatedAt);
  if (!bookingSnapshotMatches(booking.updatedAt, expectedUpdatedAt)) {
    throw new HttpError(409, "This booking changed. Refresh it before editing.");
  }

  const endsAt = body.endsAt ? new Date(body.endsAt) : undefined;
  if (endsAt && endsAt <= new Date()) throw new HttpError(400, "Return time must be in the future");

  let title = body.title;
  if (body.eventId) {
    const now = new Date();
    const event = await db.calendarEvent.findFirst({
      where: {
        id: body.eventId,
        endsAt: { gte: now },
        status: { not: CalendarEventStatus.CANCELLED },
        isHidden: false,
        archivedAt: null,
      },
      select: { id: true, summary: true },
    });
    if (!event) throw new HttpError(400, "Selected event is no longer available");
    title = displayBookingTitle(event.summary);
  }

  const eventIds = body.eventId ? [body.eventId] : [];
  if (title !== undefined || endsAt) {
    const updates = { title, endsAt };
    // With an event link, it commits in the same SERIALIZABLE transaction as
    // the title/time: a refused time never leaves a half-applied edit.
    const scheduleNotificationAssignmentIds: string[] = [];
    const linkEvents = body.eventId !== undefined
      ? [{
          afterUpdateTx: (tx: Parameters<typeof updateBookingEventsTx>[0]) => updateBookingEventsTx(tx, {
            bookingId: booking.id,
            actorUserId: actor.id,
            eventIds,
            scheduleNotificationAssignmentIds,
          }),
        }] as const
      : [] as const;
    if (isReservation) await updateReservation(booking.id, actor.id, updates, expectedUpdatedAt, ...linkEvents);
    else await updateCheckout(booking.id, actor.id, updates, expectedUpdatedAt, ...linkEvents);
    for (const assignmentId of scheduleNotificationAssignmentIds) {
      await dispatchScheduleAssignmentNotifications(assignmentId, "assigned");
    }
  } else if (body.eventId !== undefined) {
    await updateBookingEvents(booking.id, actor.id, eventIds, expectedUpdatedAt);
  }

  const updated = await db.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { id: true, title: true, endsAt: true, updatedAt: true, eventId: true },
  });
  return ok({ success: true, booking: { ...updated, title: displayBookingTitle(updated.title) } });
});
