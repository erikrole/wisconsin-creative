import { z } from "zod";
import type { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import {
  expectedWorkingScheduleDraftIdSchema,
  workingScheduleCommandSchema,
} from "@/lib/schedule-working-copy";
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

// `expectedDraftId` pairs with `expectedVersion`: the version restarts at 1 for
// every new draft, so only the draft identity tells two "v1" drafts apart.
// Omitted keeps legacy behavior; null or "" means no draft is expected yet.
const mutateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  expectedDraftId: expectedWorkingScheduleDraftIdSchema,
  command: workingScheduleCommandSchema,
});

const historySchema = z.object({
  expectedVersion: z.number().int().min(1),
  expectedDraftId: expectedWorkingScheduleDraftIdSchema,
  action: z.enum(["undo", "redo"]),
});

const rebaseSchema = z.object({
  expectedVersion: z.number().int().min(1),
  expectedDraftId: expectedWorkingScheduleDraftIdSchema,
});

// Discard reads query parameters, so an empty `expectedDraftId=` is the
// "no draft expected" form.
const discardSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  expectedDraftId: z.string().max(64).optional(),
});

async function publishEndedWorkingSchedule(
  shiftGroupId: string,
  actor: { id: string; role: Role },
  expectedVersion: number,
  expectedDraftId: string | null,
) {
  try {
    const publication = await publishShiftGroup(
      shiftGroupId,
      actor.id,
      expectedVersion,
      actor.role,
      { clearNotificationPending: true, expectedDraftId },
    );
    await Promise.allSettled(
      publication.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
    );
    return getWorkingScheduleEditor(shiftGroupId, actor.id);
  } catch (error) {
    const editor = await getWorkingScheduleEditor(shiftGroupId, actor.id);
    const message = error instanceof HttpError
      ? error.message
      : "Could not apply this correction. Review the crew and try again.";
    return { ...editor, autoReleaseError: editor.autoReleaseError ?? message };
  }
}

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
  if ("command" in body && body.command.type === "adjustSlots" && body.command.delta === 1) {
    requirePermission(user.role, "shift", "manage_positions");
  }
  const eventHasEnded = (await getWorkingScheduleEventEndsAt(params.id)).getTime() <= Date.now();
  const autoRelease = eventHasEnded
    ? null
    : await enqueuePendingScheduleRelease({
      shiftGroupId: params.id,
      version: body.expectedVersion + 1,
    });
  const data = "action" in body
    ? await changeWorkingScheduleHistory(params.id, body.expectedVersion, body.action, user, autoRelease, body.expectedDraftId)
    : await mutateWorkingSchedule(params.id, body.expectedVersion, body.command, user, autoRelease, body.expectedDraftId);
  if (eventHasEnded) {
    return ok({ data: await publishEndedWorkingSchedule(params.id, user, data.workingVersion, data.draftId) });
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
  const data = await rebaseWorkingSchedule(params.id, body.expectedVersion, user, autoRelease, body.expectedDraftId);
  if (eventHasEnded) {
    return ok({ data: await publishEndedWorkingSchedule(params.id, user, data.workingVersion, data.draftId) });
  }
  return ok({ data });
});

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 30, windowMs: 60_000 });
  const query = discardSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ data: await discardWorkingSchedule(params.id, query.expectedVersion, user, query.expectedDraftId) });
});
