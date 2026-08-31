import { BookingKind } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { forceCheckoutReservation, getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";

const forceCheckoutSchema = z.object({
  reason: z.string().trim().min(10, "Reason must be at least 10 characters").max(1000),
});

/**
 * POST /api/reservations/[id]/force-checkout
 *
 * Admin-only recovery path for a physical reservation handoff that cannot be
 * completed at a kiosk. The service opens linked checkout custody and records
 * the reasoned exception in both OverrideEvent and booking history.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;
  const body = forceCheckoutSchema.parse(await req.json());

  await requireBookingAction(id, user, "force-checkout", BookingKind.RESERVATION);
  const checkout = await forceCheckoutReservation({
    reservationId: id,
    actorUserId: user.id,
    reason: body.reason,
  });

  const refreshed = await getBookingDetail(id);
  const allowedActions = getAllowedBookingActions(user, refreshed);
  return ok({
    data: { ...refreshed, allowedActions },
    checkoutId: checkout.id,
  });
});
