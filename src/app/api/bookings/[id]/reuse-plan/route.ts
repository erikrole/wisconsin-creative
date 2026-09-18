import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { getBookingReusePlan } from "@/lib/services/booking-reuse";

/**
 * GET /api/bookings/[id]/reuse-plan
 *
 * Returns the person, pickup, kit, window, and original equipment needed to
 * start a new reservation from a past booking. Completed reservations include
 * gear that already moved onto linked checkouts.
 */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  await requireBookingAction(params.id, user, "duplicate");
  return ok({ data: await getBookingReusePlan(params.id) });
});
