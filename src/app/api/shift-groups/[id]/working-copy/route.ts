import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { workingScheduleCommandSchema } from "@/lib/schedule-working-copy";
import { badges } from "@/lib/badges";
import {
  discardWorkingSchedule,
  changeWorkingScheduleHistory,
  getWorkingScheduleEditor,
  getWorkingScheduleEventEndsAt,
  mutateWorkingSchedule,
  rebaseWorkingSchedule,
} from "@/lib/services/schedule-working-copy";
import { getPublishPreflight, publishShiftGroup } from "@/lib/services/schedule-publication";
import { enqueuePendingScheduleRelease } from "@/lib/schedule-auto-release";

const mutateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  command: workingScheduleCommandSchema,
});

const historySchema = z.object({
  expectedVersion: z.number().int().min(1),
  action: z.enum(["undo", "redo"]),
});

const rebaseSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

const discardSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  const data = await getWorkingScheduleEditor(params.id, user.id);
  // Historical release failures need current context. Keep ordinary polling
  // cheap, and never clear the failed-release state merely because a blocker
  // disappeared: a read does not enqueue or complete a release.
  if (data.hasWorkingCopy && data.autoReleaseAt && data.autoReleaseError) {
    const preflight = await getPublishPreflight(params.id);
    data.autoReleaseError = preflight.workingVersion !== data.workingVersion
      ? "The crew changed while release checks were loading. Refresh to review the latest changes."
      : preflight.staleness?.message
        ?? (preflight.blockers.length > 0
          ? preflight.blockers.map((blocker) => blocker.message).join(" ")
          : "Previous release failed. No current blockers were found. Review and save the crew to schedule another release.");
  }
  return ok({ data });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 120, windowMs: 60_000 });
  const rawBody = await req.json();
  const body = z.union([mutateSchema, historySchema]).parse(rawBody);
  const eventHasEnded = (await getWorkingScheduleEventEndsAt(params.id)).getTime() <= Date.now();
  const autoRelease = eventHasEnded
    ? null
    : await enqueuePendingScheduleRelease({
      shiftGroupId: params.id,
      version: body.expectedVersion + 1,
    });
  const data = "action" in body
    ? await changeWorkingScheduleHistory(params.id, body.expectedVersion, body.action, user, autoRelease)
    : await mutateWorkingSchedule(params.id, body.expectedVersion, body.command, user, autoRelease);
  if (eventHasEnded) {
    const publication = await publishShiftGroup(
      params.id,
      user.id,
      data.workingVersion,
      user.role,
      { clearNotificationPending: true },
    );
    await Promise.allSettled(
      publication.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
    );
    return ok({ data: await getWorkingScheduleEditor(params.id, user.id) });
  }
  return ok({ data });
});

/** Re-seat an existing draft on the current live schedule without discarding it. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 30, windowMs: 60_000 });
  const body = rebaseSchema.parse(await req.json());
  const eventHasEnded = (await getWorkingScheduleEventEndsAt(params.id)).getTime() <= Date.now();
  const autoRelease = eventHasEnded
    ? null
    : await enqueuePendingScheduleRelease({
      shiftGroupId: params.id,
      version: body.expectedVersion + 1,
    });
  const data = await rebaseWorkingSchedule(params.id, body.expectedVersion, user, autoRelease);
  if (eventHasEnded) {
    const publication = await publishShiftGroup(
      params.id,
      user.id,
      data.workingVersion,
      user.role,
      { clearNotificationPending: true },
    );
    await Promise.allSettled(
      publication.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
    );
    return ok({ data: await getWorkingScheduleEditor(params.id, user.id) });
  }
  return ok({ data });
});

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 30, windowMs: 60_000 });
  const query = discardSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ data: await discardWorkingSchedule(params.id, query.expectedVersion, user) });
});
