import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { MAX_SPORT_ROSTER_USERS_PER_REQUEST } from "@/lib/request-limits";
import { sportCodeSchema, sportRosterSchema, sportRosterBulkSchema } from "@/lib/validation";
import {
  getSportRoster,
  addToRoster,
  removeFromRoster,
  bulkAddToRoster,
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
  const sportCode = sportCodeSchema.parse(params.sportCode);
  const roster = await getSportRoster(sportCode);
  return ok({ data: roster });
});

export const POST = withAuth<{ sportCode: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_sport", "manage");
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
  const sportCode = sportCodeSchema.parse(params.sportCode);

  const { assignmentId, defaultTraveler } = z.object({
    assignmentId: z.string().cuid(),
    defaultTraveler: z.boolean(),
  }).parse(await req.json());

  const assignment = await db.studentSportAssignment.findUnique({
    where: { id: assignmentId },
    select: { sportCode: true },
  });
  if (!assignment || assignment.sportCode !== sportCode) {
    throw new HttpError(404, "Assignment not found");
  }

  const updated = await db.studentSportAssignment.update({
    where: { id: assignmentId },
    data: { defaultTraveler },
    include: { user: { select: { id: true, name: true, role: true, primaryArea: true } } },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "student_sport_assignment",
    entityId: assignmentId,
    action: "roster_travel_set",
    before: { defaultTraveler: !defaultTraveler },
    after: { sportCode, userId: updated.userId, defaultTraveler },
  });

  return ok({ data: updated });
});

export const DELETE = withAuth<{ sportCode: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_sport", "manage");
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
