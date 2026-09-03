import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { cancelReservation } from "@/lib/services/bookings";
import { BookingCustodyScope, BookingKind } from "@prisma/client";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { ok } from "@/lib/http";
import { createReservationLifecycleNotification } from "@/lib/services/notifications";
import { requireCollaboratorCapability } from "@/lib/collaborator-access";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  if (user.role === "COLLABORATOR") {
    requireCollaboratorCapability(user, "RESERVATION_CANCEL_OWN");
  }
  const { id } = params;

  await requireBookingAction(id, user, "cancel", BookingKind.RESERVATION);

  const booking = await db.booking.findUniqueOrThrow({
    where: { id },
    select: { requesterUserId: true, title: true, custodyScope: true },
  });

  // cancelReservation writes the canonical `cancelled` audit entry inside
  // its SERIALIZABLE transaction — no second audit write here.
  const result = await cancelReservation(id, user.id);
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (booking.custodyScope !== BookingCustodyScope.SHARED) {
    await createReservationLifecycleNotification({
      bookingId: id,
      bookingTitle: booking.title ?? id,
      requesterUserId: booking.requesterUserId,
      actorUserId: user.id,
      event: "cancelled",
    });
  }

  return ok(result);
});
