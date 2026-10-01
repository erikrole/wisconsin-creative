import { BookingCustodyScope, BookingKind, BookingStatus } from "@prisma/client";
import { withKiosk } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
import { readKioskStaffToken, verifyKioskStaffToken } from "@/lib/kiosk-staff-token";
import { readCheckinReportPayload, submitCheckinItemReport } from "@/lib/services/checkin-item-reports";
import { wasReturnedOnTime } from "@/lib/services/bookings-checkin";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { badges } from "@/lib/badges";

/**
 * POST /api/kiosk/checkin/[id]/report — damaged or missing at the kiosk
 * (frames G3–G5). Multipart like the web route: `actorId`, `assetId`,
 * `type` (DAMAGED | LOST), optional `description`, optional photo `file`.
 *
 * Anyone on the roster may report, the same rule as Return. DAMAGED needs the
 * item scanned back and holds it for staff; LOST accounts for the item so the
 * return can finish. Staff are notified either way. A C5 staff proof header,
 * when sent, is verified (see kiosk-staff-token).
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  await enforceRateLimit(`kiosk:checkin-report:${kiosk.kioskId}`, { max: 30, windowMs: 60_000 });

  const { parsed, file, actorId } = await readCheckinReportPayload(req);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!actorId) throw new HttpError(400, "Identify who is reporting this item");
  const actor = await requireKioskActor(db, actorId);
  // Reporting stays open to anyone on the roster (the Return rule), so no
  // staff proof is required. When C5 Staff actions send one, it must still be
  // valid for this person on this kiosk: a stale or borrowed scan is refused.
  const staffToken = readKioskStaffToken(req);
  if (staffToken) verifyKioskStaffToken(staffToken, { actorId: actor.id, kioskId: kiosk.kioskId });

  const [booking, reporter] = await Promise.all([
    db.booking.findUnique({
      where: { id: params.id },
      select: { id: true, kind: true, status: true, title: true, requesterUserId: true, custodyScope: true, locationId: true, endsAt: true },
    }),
    db.user.findUnique({ where: { id: actor.id }, select: { name: true } }),
  ]);
  const { type, assetId, description } = parsed.data;
  // The scan that returns the last item completes the checkout, so a damage
  // report for that item arrives on a COMPLETED booking. Missing needs it open.
  const reportable = booking && booking.kind === BookingKind.CHECKOUT && (
    booking.status === BookingStatus.OPEN ||
    (type === "DAMAGED" && booking.status === BookingStatus.COMPLETED)
  );
  if (!booking || !reportable) throw new HttpError(404, "Active checkout not found");

  const result = await submitCheckinItemReport({
    bookingId: booking.id,
    bookingTitle: booking.title,
    assetId,
    type,
    description,
    file,
    reporter: { id: actor.id, role: actor.role, name: reporter?.name ?? "Someone at the kiosk" },
    kiosk: { kioskId: kiosk.kioskId, locationId: kiosk.locationId, booking },
  });

  // A LOST report on the last outstanding item finished the return: same
  // follow-through as every other completion path.
  if (result.completedAt) {
    if (booking.custodyScope === BookingCustodyScope.PERSON) {
      await badges.onCheckoutReturned({
        userId: booking.requesterUserId,
        bookingId: booking.id,
        completedAt: result.completedAt,
        wasOnTime: wasReturnedOnTime(booking.endsAt, result.completedAt),
        sourceKey: booking.id,
      });
    }
    await endCheckoutReturnLiveActivities(booking.id);
  }

  return ok({
    success: true,
    reportId: result.report.id,
    type: result.report.type,
    description: result.report.description,
    imageUrl: result.report.imageUrl,
    item: result.asset,
    checkoutTitle: displayBookingTitle(booking.title),
    heldForStaff: result.heldForStaff,
    completed: result.completed,
  });
});
