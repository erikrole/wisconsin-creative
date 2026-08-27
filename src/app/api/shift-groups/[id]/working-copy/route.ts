import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { workingScheduleCommandSchema } from "@/lib/schedule-working-copy";
import { badges } from "@/lib/badges";
import {
  discardWorkingSchedule,
  getWorkingScheduleEditor,
  getWorkingScheduleEventEndsAt,
  mutateWorkingSchedule,
  rebaseWorkingSchedule,
} from "@/lib/services/schedule-working-copy";
import { publishShiftGroup } from "@/lib/services/schedule-publication";
import { enqueuePendingScheduleRelease } from "@/lib/schedule-auto-release";

const mutateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  command: workingScheduleCommandSchema,
});

const rebaseSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

const discardSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  return ok({ data: await getWorkingScheduleEditor(params.id) });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 120, windowMs: 60_000 });
  const body = mutateSchema.parse(await req.json());
  const eventHasEnded = (await getWorkingScheduleEventEndsAt(params.id)).getTime() <= Date.now();
  const autoRelease = eventHasEnded
    ? null
    : await enqueuePendingScheduleRelease({
      shiftGroupId: params.id,
      version: body.expectedVersion + 1,
    });
  const data = await mutateWorkingSchedule(params.id, body.expectedVersion, body.command, user, autoRelease);
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
    return ok({ data: await getWorkingScheduleEditor(params.id) });
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
    return ok({ data: await getWorkingScheduleEditor(params.id) });
  }
  return ok({ data });
});

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:working-copy:${user.id}`, { max: 30, windowMs: 60_000 });
  const query = discardSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ data: await discardWorkingSchedule(params.id, query.expectedVersion, user) });
});
