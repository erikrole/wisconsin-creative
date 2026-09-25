import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { BookingKind } from "@prisma/client";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { readCheckinReportPayload, submitCheckinItemReport } from "@/lib/services/checkin-item-reports";

/**
 * POST /api/checkouts/[id]/checkin-report
 *
 * Report a serialized item as damaged or lost during check-in scanning.
 * - DAMAGED: item must have been scanned first
 * - LOST: item does not need to be scanned (counts as "accounted for")
 *
 * The kiosk shares this logic through `submitCheckinItemReport`.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  const { id } = params;

  const booking = await requireBookingAction(id, user, "checkin", BookingKind.CHECKOUT);

  const { parsed, file } = await readCheckinReportPayload(req);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { assetId, type, description } = parsed.data;
  const { report } = await submitCheckinItemReport({
    bookingId: id,
    bookingTitle: booking.title,
    assetId,
    type,
    description,
    file,
    reporter: { id: user.id, role: user.role, name: user.name },
  });

  return ok({
    id: report.id,
    type: report.type,
    description: report.description,
    imageUrl: report.imageUrl,
  });
});
