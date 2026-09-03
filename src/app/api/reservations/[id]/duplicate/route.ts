import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { BookingKind } from "@prisma/client";
import { requireBookingAction } from "@/lib/services/booking-rules";

/**
 * POST /api/reservations/[id]/duplicate
 *
 * Compatibility endpoint for the retired same-context duplicate action.
 * Reuse now starts in the reservation composer, where a different event and
 * fresh window are required before the copied equipment can be submitted.
 *
 * Permission: staff+ or owner (enforced via "duplicate" action).
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const { id } = params;

  await requireBookingAction(id, user, "duplicate", BookingKind.RESERVATION);
  throw new HttpError(409, "Choose a new event before reusing this reservation's gear", {
    reuseUrl: `/reservations/new?reuseFrom=${encodeURIComponent(id)}`,
  });
});
