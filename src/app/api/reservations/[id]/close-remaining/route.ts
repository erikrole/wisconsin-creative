import { BookingKind } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { closeReservationRemaining, getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";

const closeRemainingSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/reservations/[id]/close-remaining
 *
 * Staff/admin exit for a partially picked-up reservation whose remaining
 * gear is not coming: keeps the picked-up history and linked checkout,
 * releases the leftover holds, completes the reservation, and records what
 * was released.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;
  const body = closeRemainingSchema.parse(await req.json().catch(() => ({})));

  await requireBookingAction(id, user, "close-remaining", BookingKind.RESERVATION);
  const result = await closeReservationRemaining({
    reservationId: id,
    actorUserId: user.id,
    reason: body.reason,
  });

  const refreshed = await getBookingDetail(id);
  const allowedActions = getAllowedBookingActions(user, refreshed);
  return ok({
    data: { ...refreshed, allowedActions },
    released: {
      serialized: result.releasedSerialized,
      bulk: result.releasedBulk,
    },
  });
});
