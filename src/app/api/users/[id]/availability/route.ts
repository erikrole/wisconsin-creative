import { createHash } from "node:crypto";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { Prisma, type StudentAvailabilityBlock } from "@prisma/client";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { withSerializationRetry } from "@/lib/serialization";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { createAuditEntryTx } from "@/lib/audit";
import { recomputeFutureAssignmentAvailabilityConflictsForUser } from "@/lib/services/availability-conflict-recompute";
import { z } from "zod";
import { parseDateOnly, assertBlockShape, normalizedTimes, availabilityDateSchema, availabilityTimeSchema } from "./_shared";

const createBlockSchema = z.object({
  requestId:        z.string().uuid().transform((value) => value.toLowerCase()).optional(),
  kind:             z.enum(["WEEKLY", "AD_HOC"]).default("WEEKLY"),
  intent:           z.enum(["CANNOT_WORK", "PREFER", "DISLIKE", "TIME_OFF"]).default("CANNOT_WORK"),
  status:           z.enum(["APPROVED", "PENDING", "DENIED"]).optional(),
  daysOfWeek:       z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  dayOfWeek:        z.number().int().min(0).max(6).optional().nullable(),
  date:             availabilityDateSchema.optional().nullable(),
  dateEndsOn:       availabilityDateSchema.optional().nullable(),
  allDay:           z.boolean().optional().default(false),
  startsAt:         availabilityTimeSchema,
  endsAt:           availabilityTimeSchema,
  label:            z.string().trim().max(80).optional(),
  semesterLabel:    z.string().trim().max(40).optional(),
  semesterStartsOn: availabilityDateSchema.optional().nullable(),
  semesterEndsOn:   availabilityDateSchema.optional().nullable(),
  reviewNote:       z.string().trim().max(500).optional().nullable(),
});

async function assertTargetStudentWorker(id: string, client: Prisma.TransactionClient) {
  const target = await client.user.findUnique({ where: { id }, select: { id: true, staffingType: true } });
  if (!target) throw new HttpError(404, "User not found");
  if (target.staffingType !== "ST") {
    throw new HttpError(400, "Availability is only available for Student scheduling class");
  }
}

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "student_availability", "view");
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
  requirePermission(user.role, "student_availability", "create");
  const { id } = params;

  if (user.role === "STUDENT" && user.id !== id) {
    throw new HttpError(403, "Forbidden");
  }
  await enforceRateLimit(`availability:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const body = createBlockSchema.parse(await req.json());
  if (body.daysOfWeek && (body.kind !== "WEEKLY" || body.dayOfWeek != null)) {
    throw new HttpError(400, "Choose weekdays only for a weekly entry");
  }
  if (body.daysOfWeek && new Set(body.daysOfWeek).size !== body.daysOfWeek.length) {
    throw new HttpError(400, "Choose each weekday once");
  }
  const days = body.daysOfWeek ? [...body.daysOfWeek].sort((a, b) => a - b) : [body.dayOfWeek];
  for (const dayOfWeek of days) assertBlockShape({ ...body, dayOfWeek });
  const staffReview = user.role === "ADMIN" || user.role === "STAFF";
  if (!staffReview && ((body.intent === "TIME_OFF" && body.status && body.status !== "PENDING") || body.reviewNote?.trim())) {
    throw new HttpError(403, "Only staff can review time-off requests");
  }
  const status = body.intent === "TIME_OFF"
    ? body.status ?? (staffReview ? "APPROVED" : "PENDING")
    : "APPROVED";
  const times = normalizedTimes(body);

  const reviewed = body.intent === "TIME_OFF" && staffReview && status !== "PENDING";
  const data = {
    userId: id,
    kind: body.kind,
    intent: body.intent,
    status,
    date: body.kind === "AD_HOC" ? parseDateOnly(body.date) : null,
    dateEndsOn: body.kind === "AD_HOC" ? parseDateOnly(body.dateEndsOn ?? body.date) : null,
    allDay: body.kind === "AD_HOC" ? body.allDay : false,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    label: body.label || null,
    semesterLabel: body.semesterLabel || null,
    semesterStartsOn: parseDateOnly(body.semesterStartsOn),
    semesterEndsOn: parseDateOnly(body.semesterEndsOn),
    reviewedById: reviewed ? user.id : null,
    reviewNote: reviewed ? body.reviewNote || null : null,
  } satisfies Prisma.StudentAvailabilityBlockUncheckedCreateInput;
  const payloadHash = createHash("sha256").update(JSON.stringify({ ...data, days })).digest("hex");
  const saveKey = body.requestId ? { actorId: user.id, requestId: body.requestId } : null;
  let blocks: StudentAvailabilityBlock[];
  try {
    blocks = await withSerializationRetry(() => db.$transaction(async (tx) => {
      await assertTargetStudentWorker(id, tx);
      // Claim the unique key inside the same transaction as all its effects.
      if (saveKey) await tx.studentAvailabilitySave.create({ data: { ...saveKey, payloadHash } });
      const createdBlocks = [];
      for (const dayOfWeek of days) {
        const created = await tx.studentAvailabilityBlock.create({
          data: { ...data, dayOfWeek: body.kind === "WEEKLY" ? dayOfWeek : null, reviewedAt: reviewed ? new Date() : null },
        });

        await createAuditEntryTx(tx, {
          actorId: user.id,
          actorRole: user.role,
          entityType: "student_availability_block",
          entityId: created.id,
          action: "student_availability_created",
          after: {
            userId: id,
            kind: created.kind,
            intent: created.intent,
            status: created.status,
            dayOfWeek: created.dayOfWeek,
            date: created.date,
            dateEndsOn: created.dateEndsOn,
            allDay: created.allDay,
            startsAt: created.startsAt,
            endsAt: created.endsAt,
            label: created.label,
            semesterLabel: created.semesterLabel,
            semesterStartsOn: created.semesterStartsOn,
            semesterEndsOn: created.semesterEndsOn,
            reviewedAt: created.reviewedAt,
            reviewedById: created.reviewedById,
            reviewNote: created.reviewNote,
          },
        });

        createdBlocks.push(created);
      }
      await recomputeFutureAssignmentAvailabilityConflictsForUser(id, { client: tx });
      if (saveKey) await tx.studentAvailabilitySave.update({
        where: { actorId_requestId: saveKey },
        data: { blockIds: createdBlocks.map((block) => block.id) },
      });
      return createdBlocks;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }));
  } catch (error) {
    if (!saveKey || !isUniqueConstraintError(error)) throw error;
    const saved = await db.studentAvailabilitySave.findUnique({ where: { actorId_requestId: saveKey } });
    if (!saved) throw error;
    if (saved.payloadHash !== payloadHash) {
      throw new HttpError(409, "This save already completed with different details. Refresh availability and edit the saved entries.");
    }
    const current = await db.studentAvailabilityBlock.findMany({ where: { userId: id, id: { in: saved.blockIds } } });
    if (current.length !== saved.blockIds.length) {
      throw new HttpError(409, "This save already completed, but some entries were removed. Refresh availability before adding new entries.");
    }
    const byId = new Map(current.map((block) => [block.id, block]));
    blocks = saved.blockIds.map((blockId) => byId.get(blockId)!);
  }

  return ok({ data: blocks[0], ...(body.daysOfWeek ? { blocks } : {}) }, 201);
});
