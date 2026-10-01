import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { BookingKind } from "@prisma/client";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { readCheckinReportPayload, submitBulkCheckinReport, submitCheckinItemReport } from "@/lib/services/checkin-item-reports";

/**
 * POST /api/checkouts/[id]/checkin-report
 *
 * Report an item as damaged or lost during check-in scanning: a serialized
 * asset, a numbered bulk unit, or a counted quantity of bulk stock.
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

  const { assetId, bulkSkuUnitId, bulkSkuId, quantity, type, description } = parsed.data;
  const reporter = { id: user.id, role: user.role, name: user.name };
  const { report } = assetId
    ? await submitCheckinItemReport({ bookingId: id, bookingTitle: booking.title, assetId, type, description, file, reporter })
    : await submitBulkCheckinReport({
        bookingId: id,
        bookingTitle: booking.title,
        target: bulkSkuUnitId
          ? { kind: "unit", bulkSkuUnitId }
          : { kind: "counted", bulkSkuId: bulkSkuId!, quantity: quantity! },
        type,
        description,
        file,
        reporter,
        locationId: (await db.booking.findUniqueOrThrow({ where: { id }, select: { locationId: true } })).locationId,
        returnedFor: booking,
      });

  return ok({
    id: report.id,
    type: report.type,
    description: report.description,
    imageUrl: report.imageUrl,
    quantity: report.quantity ?? null,
  });
});
