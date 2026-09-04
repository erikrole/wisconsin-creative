import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { mergeCheckouts } from "@/lib/services/bookings";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { updateCheckoutReturnLiveActivities } from "@/lib/services/live-activities";

const schema = z.object({
  ids: z.array(z.string().cuid()).min(2).max(25),
}).strict();

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "checkout", "merge");
  const { allowed } = await checkRateLimit(`checkout:merge:${user.id}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!allowed) throw new HttpError(429, "Too many merge requests. Please wait a moment.");

  const body = schema.parse(await req.json());
  const checkout = await mergeCheckouts({
    ids: body.ids,
    actorUserId: user.id,
    actorRole: user.role,
  });
  deferCompanionProjectionRefreshForCommittedMutation(req);

  if (checkout.status === "OPEN") {
    await updateCheckoutReturnLiveActivities({
      bookingId: checkout.id,
      endsAt: checkout.endsAt,
    });
    await scheduleCheckoutReturnLiveActivity({
      bookingId: checkout.id,
      endsAt: checkout.endsAt,
    });
  }

  return ok({
    data: checkout,
    meta: {
      mergedCheckoutIds: body.ids.filter((id) => id !== checkout.id),
      message: `Merged ${body.ids.length} checkouts into ${checkout.title}.`,
    },
  });
});
