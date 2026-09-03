import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import {
  combineScheduleEvents,
  previewCombinedScheduleEvents,
  uncombineScheduleEvents,
} from "@/lib/services/combined-schedule-events";

const combineSchema = z.object({
  eventIds: z.tuple([z.string().cuid(), z.string().cuid()]),
  apply: z.boolean().optional().default(false),
  expectedPrimaryId: z.string().cuid().optional(),
  expectedSecondaryWorkingVersion: z.number().int().positive().nullable().optional(),
});

const uncombineSchema = z.object({
  primaryEventId: z.string().cuid(),
  secondaryEventId: z.string().cuid(),
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift", "manage");
  const rawBody = await req.json().catch(() => {
    throw new HttpError(400, "Request body must be valid JSON.");
  });
  const body = combineSchema.parse(rawBody);
  if (!body.apply) {
    return ok({ data: await previewCombinedScheduleEvents(body.eventIds) });
  }
  if (!body.expectedPrimaryId || body.expectedSecondaryWorkingVersion === undefined) {
    throw new HttpError(400, "Review the combine preview before applying it.");
  }
  await enforceRateLimit(`calendar-event:combine:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  if (user.role !== "ADMIN" && user.role !== "STAFF") {
    throw new HttpError(403, "Only staff and admins can combine events.");
  }
  const result = await combineScheduleEvents({
    eventIds: body.eventIds,
    expectedPrimaryId: body.expectedPrimaryId,
    expectedSecondaryWorkingVersion: body.expectedSecondaryWorkingVersion,
    actor: { id: user.id, role: user.role },
  });
  return ok({ data: result });
});

export const DELETE = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift", "manage");
  const rawBody = await req.json().catch(() => {
    throw new HttpError(400, "Request body must be valid JSON.");
  });
  const body = uncombineSchema.parse(rawBody);
  await enforceRateLimit(`calendar-event:uncombine:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  if (user.role !== "ADMIN" && user.role !== "STAFF") {
    throw new HttpError(403, "Only staff and admins can undo combined events.");
  }
  return ok({
    data: await uncombineScheduleEvents({
      ...body,
      actor: { id: user.id, role: user.role },
    }),
  });
});
