import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok, HttpError } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { MAX_SPORT_ROSTER_USERS_PER_REQUEST } from "@/lib/request-limits";
import { sportCodeSchema, sportRosterSchema, sportRosterBulkSchema } from "@/lib/validation";
import {
  getSportRoster,
  addToRoster,
  removeFromRoster,
  bulkAddToRoster,
  setRosterTravelStatus,
} from "@/lib/services/sport-configs";
import { createAuditEntry } from "@/lib/audit";

const rosterBodySchema = z.union([
  z.object({
    userIds: z
      .array(z.string().cuid())
      .min(1)
      .max(MAX_SPORT_ROSTER_USERS_PER_REQUEST),
  }),
  z.object({ userId: z.string().cuid() }),
]);

export const GET = withAuth<{ sportCode: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "student_sport", "view");
  await enforceRateLimit(`sport-roster:read:${user.id}`, { max: 60, windowMs: 60_000 });
  const sportCode = sportCodeSchema.parse(params.sportCode);
  const roster = await getSportRoster(sportCode);
  return ok({ data: roster });
});

export const POST = withAuth<{ sportCode: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_sport", "manage");
  await enforceRateLimit(`sport-roster:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const sportCode = sportCodeSchema.parse(params.sportCode);

  let body: z.infer<typeof rosterBodySchema>;
  try {
    body = rosterBodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new HttpError(400, err.errors.map((e) => e.message).join(", "));
    }
    throw err;
  }

  // Support both single and bulk add
  if ("userIds" in body) {
    const parsed = sportRosterBulkSchema.parse({ ...body, sportCode });
    const roster = await bulkAddToRoster(parsed.userIds, parsed.sportCode);

    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "student_sport_assignment",
      entityId: parsed.sportCode,
      action: "roster_bulk_added",
      after: { sportCode: parsed.sportCode, userIds: parsed.userIds },
    });

    return ok({ data: roster }, 201);
  }

  const parsed = sportRosterSchema.parse({ ...body, sportCode });
  const assignment = await addToRoster(parsed.userId, parsed.sportCode);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "student_sport_assignment",
    entityId: assignment.id,
    action: "roster_added",
    after: { sportCode: parsed.sportCode, userId: parsed.userId },
  });

  return ok({ data: assignment }, 201);
});

export const PATCH = withAuth<{ sportCode: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_sport", "manage");
  await enforceRateLimit(`sport-roster:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const sportCode = sportCodeSchema.parse(params.sportCode);

  const body = z.union([
    z.object({ assignmentId: z.string().cuid(), defaultTraveler: z.boolean() }),
    z.object({
      assignmentIds: z.array(z.string().cuid())
        .min(1)
        .max(MAX_SPORT_ROSTER_USERS_PER_REQUEST)
        .refine((ids) => new Set(ids).size === ids.length, "Roster members must be unique"),
      defaultTraveler: z.boolean(),
    }),
  ]).parse(await req.json());
  const assignmentIds = "assignmentIds" in body ? body.assignmentIds : [body.assignmentId];

  const updated = await setRosterTravelStatus({
    assignmentIds,
    sportCode,
    defaultTraveler: body.defaultTraveler,
    actor: { id: user.id, role: user.role },
  });

  return ok({ data: "assignmentIds" in body ? updated : updated[0] });
});

export const DELETE = withAuth<{ sportCode: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_sport", "manage");
  await enforceRateLimit(`sport-roster:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const sportCode = sportCodeSchema.parse(params.sportCode);
  const url = new URL(req.url);
  const assignmentId = url.searchParams.get("assignmentId");

  if (!assignmentId) {
    throw new HttpError(400, "assignmentId query parameter required");
  }

  await removeFromRoster(assignmentId);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "student_sport_assignment",
    entityId: assignmentId,
    action: "roster_removed",
    after: { sportCode, assignmentId },
  });

  return ok({ success: true });
});
