import { after } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { badges } from "@/lib/badges";
import {
  createPublishedShiftGroupNotifications,
  notifyPublishedScheduleFollowers,
  notifyPublishedShiftGroupWorkers,
} from "@/lib/services/notifications";
import {
  getWorkingScheduleEditor,
  getWorkingScheduleEventEndsAt,
} from "@/lib/services/schedule-working-copy";
import { publishShiftGroup } from "@/lib/services/schedule-publication";
import { expectedWorkingScheduleDraftIdSchema } from "@/lib/schedule-working-copy";

const publishSchema = z.object({
  expectedVersion: z.number().int().min(1),
  // The editor's `draftId`; omitted keeps legacy version-only behavior.
  expectedDraftId: expectedWorkingScheduleDraftIdSchema,
});

export const GET = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "manage");
  throw new HttpError(405, "Use POST to publish pending schedule changes now.");
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "publish_now");
  await enforceRateLimit(`shift:publish-now:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const body = publishSchema.parse(await req.json());
  const eventHasEnded = (await getWorkingScheduleEventEndsAt(params.id)).getTime() <= Date.now();
  const publication = await publishShiftGroup(
    params.id,
    user.id,
    body.expectedVersion,
    user.role,
    {
      clearNotificationPending: eventHasEnded,
      manualPublish: true,
      requireWorkingCopy: true,
      expectedDraftId: body.expectedDraftId,
    },
  );

  if (eventHasEnded) {
    await Promise.allSettled(
      publication.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
    );
  } else if (!publication.before.publishedAt) {
    after(() => createPublishedShiftGroupNotifications(params.id));
  } else if (publication.publishedSnapshotChanged) {
    after(() => Promise.allSettled([
      notifyPublishedShiftGroupWorkers(params.id, publication.affectedUserIds),
      notifyPublishedScheduleFollowers(params.id),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("Manual schedule publication notification failed", result.reason);
        }
      }
    }));
  }

  return ok({ data: await getWorkingScheduleEditor(params.id, user.id) });
});
