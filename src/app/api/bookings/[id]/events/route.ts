import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { getAllowedBookingActions, requireBookingAction } from "@/lib/services/booking-rules";
import { getBookingDetail, updateBookingEvents } from "@/lib/services/bookings";
import { updateBookingEventsSchema } from "@/lib/validation";
import { requireCollaboratorCapability } from "@/lib/collaborator-access";
import { collaboratorBookingResponse } from "@/lib/collaborator-gear";
import {
  bookingSnapshotMatches,
  parseBookingSnapshotHeader,
  staleBookingError,
} from "@/lib/booking-concurrency";
import { sortedStrings } from "@/lib/utils";

function currentEventIds(detail: Awaited<ReturnType<typeof getBookingDetail>>) {
  if (detail.events && detail.events.length > 0) {
    return detail.events.map((event) => event.id);
  }
  return detail.event ? [detail.event.id] : [];
}

function sameEventSet(requested: string[], detail: Awaited<ReturnType<typeof getBookingDetail>>) {
  return JSON.stringify(sortedStrings(requested)) === JSON.stringify(sortedStrings(currentEventIds(detail)));
}

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  if (user.role === "COLLABORATOR") {
    requireCollaboratorCapability(user, "RESERVATION_EDIT_OWN");
  }
  const { id } = params;
  const body = updateBookingEventsSchema.parse(await req.json());

  const current = await getBookingDetail(id);

  const expectedUpdatedAt = parseBookingSnapshotHeader(req);
  if (!bookingSnapshotMatches(current.updatedAt, expectedUpdatedAt)) {
    if (sameEventSet(body.eventIds, current)) {
      await requireBookingAction(id, user, "edit");
      const allowedActions = getAllowedBookingActions(user, current);
      return ok({
        data: user.role === "COLLABORATOR"
          ? collaboratorBookingResponse(current, allowedActions)
          : { ...current, allowedActions },
      });
    }
    throw staleBookingError();
  }

  await requireBookingAction(id, user, "edit");
  await updateBookingEvents(id, user.id, body.eventIds, expectedUpdatedAt);

  const refreshed = await getBookingDetail(id);
  const allowedActions = getAllowedBookingActions(user, refreshed);
  return ok({
    data: user.role === "COLLABORATOR"
      ? collaboratorBookingResponse(refreshed, allowedActions)
      : { ...refreshed, allowedActions },
  });
});
