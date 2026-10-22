import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { listBookingReports } from "@/lib/services/damage-cases";

/**
 * GET /api/bookings/[id]/reports
 *
 * Damaged or missing reports on a checkout and where each stands. Visible to
 * staff and admins and to the person the checkout is for, so a borrower can see
 * what was reported on their return and what happened to it.
 */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  const booking = await db.booking.findUnique({
    where: { id: params.id },
    select: { requesterUserId: true, createdBy: true },
  });
  if (!booking) throw new HttpError(404, "Booking not found");
  const staff = user.role === "ADMIN" || user.role === "STAFF";
  if (!staff && booking.requesterUserId !== user.id && booking.createdBy !== user.id) {
    throw new HttpError(403, "Not allowed");
  }
  return ok({ data: await listBookingReports(params.id) });
});
