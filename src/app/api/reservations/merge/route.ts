import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { mergeReservations } from "@/lib/services/bookings";
import { createReservationLifecycleNotification } from "@/lib/services/notifications";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { BookingCustodyScope } from "@prisma/client";

const schema = z.object({
  ids: z.array(z.string().cuid()).min(2).max(25),
}).strict();

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);
  const { allowed } = await checkRateLimit(`reservation:merge:${user.id}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!allowed) throw new HttpError(429, "Too many merge requests. Please wait a moment.");

  const body = schema.parse(await req.json());
  const reservation = await mergeReservations({
    ids: body.ids,
    actorUserId: user.id,
    actorRole: user.role,
  });
  deferCompanionProjectionRefreshForCommittedMutation(req);
  if (reservation.custodyScope !== BookingCustodyScope.SHARED) {
    await createReservationLifecycleNotification({
      bookingId: reservation.id,
      bookingTitle: reservation.title,
      requesterUserId: reservation.requesterUserId,
      actorUserId: user.id,
      event: "updated",
    });
  }

  return ok({
    data: reservation,
    meta: {
      mergedReservationIds: body.ids.filter((id) => id !== reservation.id),
      message: `Merged ${body.ids.length} reservations into ${reservation.title}.`,
    },
  });
});
