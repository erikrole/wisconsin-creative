import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { cancelBooking, getBookingDetail } from "@/lib/services/bookings";
import { requireBookingAction, getAllowedBookingActions } from "@/lib/services/booking-rules";
import { requireCollaboratorCapability } from "@/lib/collaborator-access";
import { sanitizeCollaboratorBooking } from "@/lib/collaborator-gear";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  if (user.role === "COLLABORATOR") {
    requireCollaboratorCapability(user, "RESERVATION_CANCEL_OWN");
  }
  const { id } = params;

  await requireBookingAction(id, user, "cancel");

  // Service creates audit entry internally
  await cancelBooking(id, user.id, { allowActiveCheckout: user.role === "ADMIN" });

  // Re-fetch enriched detail so UI has full state
  const refreshed = await getBookingDetail(id);
  const allowedActions = getAllowedBookingActions(user, refreshed);
  return ok({
    data: user.role === "COLLABORATOR"
      ? { ...sanitizeCollaboratorBooking(refreshed), allowedActions }
      : { ...refreshed, allowedActions },
  });
});
