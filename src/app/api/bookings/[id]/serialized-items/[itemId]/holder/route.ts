import { after } from "next/server";
import { withAuth } from "@/lib/api";
import { parseBookingSnapshotHeader } from "@/lib/booking-concurrency";
import { ok } from "@/lib/http";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { requirePermission } from "@/lib/rbac";
import { getBookingDetail, updateBookingItemHolder } from "@/lib/services/bookings";
import { getAllowedBookingActions } from "@/lib/services/booking-rules";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { updateBookingItemHolderSchema } from "@/lib/validation";

export const POST = withAuth<{ id: string; itemId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "checkout", "manage_custody");
  const body = updateBookingItemHolderSchema.refine((input) => input.targetUserId !== null, {
    message: "Select the person receiving the item", path: ["targetUserId"],
  }).parse(await req.json());
  const transfer = await updateBookingItemHolder({
    bookingId: params.id, serializedItemId: params.itemId,
    actorUserId: user.id, targetUserId: body.targetUserId, reason: body.reason,
    expectedUpdatedAt: parseBookingSnapshotHeader(req),
  });

  // Delivery runs outside the transaction and response critical path. Every
  // workflow rechecks current custody; a delivery failure cannot undo transfer.
  after(async () => {
    const results = await Promise.allSettled([
      scheduleCheckoutReturnLiveActivity({ bookingId: transfer.targetBookingId, endsAt: transfer.endsAt }),
      ...(transfer.sourceClosed ? [endCheckoutReturnLiveActivities(transfer.sourceBookingId)] : []),
    ]);
    for (const result of results) {
      if (result.status === "rejected") console.error("[Item transfer] reminder refresh failed", result.reason);
    }
  });
  const refreshed = await getBookingDetail(params.id);
  return ok({
    data: { ...refreshed, allowedActions: getAllowedBookingActions(user, refreshed) },
    transfer,
  });
});
