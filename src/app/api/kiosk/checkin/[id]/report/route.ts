import { BookingKind, BookingStatus } from "@prisma/client";
import { withKiosk } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
import { readKioskStaffToken, verifyKioskStaffToken } from "@/lib/kiosk-staff-token";
import { finishReportCompletedReturn, readCheckinReportPayload, submitBulkCheckinReport, submitCheckinItemReport } from "@/lib/services/checkin-item-reports";
import { kioskOperationContext, readKioskOperationReplay } from "@/lib/services/kiosk-operation-receipts";

/**
 * POST /api/kiosk/checkin/[id]/report — damaged or missing at the kiosk
 * (frames G3–G5). Multipart like the web route: `actorId`, one target
 * (`assetId` | `bulkSkuUnitId` | `bulkSkuId` + `quantity`), `type`
 * (DAMAGED | LOST), optional `description`, optional photo `file`.
 *
 * Anyone on the roster may report, the same rule as Return. DAMAGED needs the
 * item scanned back and holds it for staff; LOST accounts for the item so the
 * return can finish. Staff are notified either way. A C5 staff proof header,
 * when sent, is verified (see kiosk-staff-token).
 */
export const POST = withKiosk<{ id: string }>(async (req, { kiosk, params }) => {
  await enforceRateLimit(`kiosk:checkin-report:${kiosk.kioskId}`, { max: 30, windowMs: 60_000 });

  const { parsed, file, actorId, requestId } = await readCheckinReportPayload(req);
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
  const { type, assetId, bulkSkuUnitId, bulkSkuId, quantity, description } = parsed.data;
  // The scan that returns the last item completes the checkout, so a damage
  // report for that item arrives on a COMPLETED booking. Missing needs it open.
  const reportable = booking && booking.kind === BookingKind.CHECKOUT && (
    booking.status === BookingStatus.OPEN ||
    (type === "DAMAGED" && booking.status === BookingStatus.COMPLETED)
  );
  if (!booking || !reportable) throw new HttpError(404, "Active checkout not found");

  const reporterInfo = { id: actor.id, role: actor.role, name: reporter?.name ?? "Someone at the kiosk" };
  const respond = (result: {
    report: { id: string; type: string; description: string | null; imageUrl: string | null; quantity?: number | null };
    item: unknown;
    heldForStaff: boolean;
    completed: boolean;
  }) => ({
    success: true,
    reportId: result.report.id,
    type: result.report.type,
    description: result.report.description,
    imageUrl: result.report.imageUrl,
    item: result.item,
    quantity: result.report.quantity ?? null,
    checkoutTitle: displayBookingTitle(booking.title),
    heldForStaff: result.heldForStaff,
    completed: result.completed,
  });
  // Bulk reports move counts (counted stock increments), so a retried submit
  // carries the same reference and replays the first answer.
  const receipt = !assetId
    ? kioskOperationContext({
        requestId,
        kioskId: kiosk.kioskId,
        actorId: actor.id,
        operation: "checkin-report",
        sourceId: booking.id,
        payload: { type, bulkSkuUnitId, bulkSkuId, quantity, description },
      })
    : undefined;
  const replay = await readKioskOperationReplay(db, receipt);
  if (replay) return ok(replay);
  const result = assetId
    ? await submitCheckinItemReport({
        bookingId: booking.id,
        bookingTitle: booking.title,
        assetId,
        type,
        description,
        file,
        reporter: reporterInfo,
        kiosk: { kioskId: kiosk.kioskId, locationId: kiosk.locationId, booking },
      }).then((r) => ({ ...r, item: r.asset }))
    : await submitBulkCheckinReport({
        bookingId: booking.id,
        bookingTitle: booking.title,
        target: bulkSkuUnitId
          ? { kind: "unit", bulkSkuUnitId }
          : { kind: "counted", bulkSkuId: bulkSkuId!, quantity: quantity! },
        type,
        description,
        file,
        reporter: reporterInfo,
        // Restock and completion run where the gear physically came back,
        // the same as the quantity route (D-032).
        locationId: kiosk.locationId,
        returnedFor: booking,
        kiosk: { kioskId: kiosk.kioskId },
        receipt: receipt ? { context: receipt, respond } : undefined,
      }).catch(async (error) => {
        // A concurrent resend of the same reference committed first: answer
        // with its result rather than an error.
        const committed = receipt ? await readKioskOperationReplay(db, receipt).catch(() => null) : null;
        if (committed) return { replayed: committed };
        throw error;
      });
  if ("replayed" in result) return ok(result.replayed);

  // A LOST report on the last outstanding item finished the return: same
  // follow-through as every other completion path.
  await finishReportCompletedReturn(booking, result.completedAt);

  return ok(respond(result));
});
