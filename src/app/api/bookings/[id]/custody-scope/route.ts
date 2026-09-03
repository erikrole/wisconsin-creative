import { BookingKind } from "@prisma/client";
import { withAuth } from "@/lib/api";
import {
  bookingSnapshotMatches,
  parseBookingSnapshotHeader,
  staleBookingError,
} from "@/lib/booking-concurrency";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { updateBookingCustodyScope } from "@/lib/services/booking-custody";
import { getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import { updateBookingCustodyScopeSchema } from "@/lib/validation";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "checkout", "manage_custody");
  const body = updateBookingCustodyScopeSchema.parse(await req.json());
  const current = await getBookingDetail(params.id);
  const expectedUpdatedAt = parseBookingSnapshotHeader(req);

  await requireBookingAction(params.id, user, "manage-custody", BookingKind.CHECKOUT);

  if (!bookingSnapshotMatches(current.updatedAt, expectedUpdatedAt)) {
    if (current.custodyScope === body.custodyScope) {
      return ok({
        data: {
          ...current,
          allowedActions: getAllowedBookingActions(user, current),
        },
      });
    }
    throw staleBookingError();
  }

  await updateBookingCustodyScope({
    bookingId: params.id,
    actorUserId: user.id,
    custodyScope: body.custodyScope,
    expectedUpdatedAt,
  });

  const refreshed = await getBookingDetail(params.id);
  return ok({
    data: {
      ...refreshed,
      allowedActions: getAllowedBookingActions(user, refreshed),
    },
  });
});
