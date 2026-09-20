import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";
import { recomputeFutureAssignmentAvailabilityConflictsForUser } from "@/lib/services/availability-conflict-recompute";
import { z } from "zod";
import { parseDateOnly, assertBlockShape, normalizedTimes } from "./_shared";

const createBlockSchema = z.object({
  kind:             z.enum(["WEEKLY", "AD_HOC"]).default("WEEKLY"),
  intent:           z.enum(["CANNOT_WORK", "PREFER", "DISLIKE", "TIME_OFF"]).default("CANNOT_WORK"),
  status:           z.enum(["APPROVED", "PENDING", "DENIED"]).optional(),
  dayOfWeek:        z.number().int().min(0).max(6).optional().nullable(),
  date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable(),
  dateEndsOn:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable(),
  allDay:           z.boolean().optional().default(false),
  startsAt:         z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm"),
  endsAt:           z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm"),
  label:            z.string().trim().max(80).optional(),
  semesterLabel:    z.string().trim().max(40).optional(),
  semesterStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable(),
  semesterEndsOn:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable(),
  reviewNote:       z.string().trim().max(500).optional().nullable(),
});

async function assertTargetStudentWorker(id: string) {
  const target = await db.user.findUnique({ where: { id }, select: { id: true, staffingType: true } });
  if (!target) throw new HttpError(404, "User not found");
  if (target.staffingType !== "ST") {
    throw new HttpError(400, "Availability is only available for Student scheduling class");
  }
}

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);
  const { id } = params;

  if (user.role === "STUDENT" && user.id !== id) {
    throw new HttpError(403, "Forbidden");
  }

  const blocks = await db.studentAvailabilityBlock.findMany({
    where: { userId: id },
    orderBy: [{ kind: "asc" }, { dayOfWeek: "asc" }, { date: "asc" }, { startsAt: "asc" }],
  });

  return ok({ data: blocks });
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);
  const { id } = params;

  if (user.role === "STUDENT" && user.id !== id) {
    throw new HttpError(403, "Forbidden");
  }
  await enforceRateLimit(`availability:${user.id}`, SETTINGS_MUTATION_LIMIT);

  await assertTargetStudentWorker(id);

  const body = createBlockSchema.parse(await req.json());
  assertBlockShape(body);
  const staffReview = user.role === "ADMIN" || user.role === "STAFF";
  const status = body.intent === "TIME_OFF"
    ? body.status ?? (staffReview ? "APPROVED" : "PENDING")
    : "APPROVED";
  const times = normalizedTimes(body);

  const block = await db.studentAvailabilityBlock.create({
    data: {
      userId:           id,
      kind:             body.kind,
      intent:           body.intent,
      status,
      dayOfWeek:        body.kind === "WEEKLY" ? body.dayOfWeek : null,
      date:             body.kind === "AD_HOC" ? parseDateOnly(body.date) : null,
      dateEndsOn:       body.kind === "AD_HOC" ? parseDateOnly(body.dateEndsOn ?? body.date) : null,
      allDay:           body.kind === "AD_HOC" ? body.allDay : false,
      startsAt:         times.startsAt,
      endsAt:           times.endsAt,
      label:            body.label ?? null,
      semesterLabel:    body.semesterLabel ?? null,
      semesterStartsOn: parseDateOnly(body.semesterStartsOn),
      semesterEndsOn:   parseDateOnly(body.semesterEndsOn),
      reviewedAt:       body.intent === "TIME_OFF" && staffReview && status !== "PENDING" ? new Date() : null,
      reviewedById:     body.intent === "TIME_OFF" && staffReview && status !== "PENDING" ? user.id : null,
      reviewNote:       body.reviewNote?.trim() || null,
    },
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "student_availability_block",
    entityId: block.id,
    action: "student_availability_created",
    after: {
      userId: id,
      kind: block.kind,
      intent: block.intent,
      status: block.status,
      dayOfWeek: block.dayOfWeek,
      date: block.date,
      dateEndsOn: block.dateEndsOn,
      allDay: block.allDay,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      label: block.label,
      semesterLabel: block.semesterLabel,
      semesterStartsOn: block.semesterStartsOn,
      semesterEndsOn: block.semesterEndsOn,
      reviewedAt: block.reviewedAt,
      reviewedById: block.reviewedById,
      reviewNote: block.reviewNote,
    },
  });

  await recomputeFutureAssignmentAvailabilityConflictsForUser(id);

  return ok({ data: block }, 201);
});
