import { availabilityDateKey } from "@/lib/student-availability-display";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { Prisma } from "@prisma/client";
import { withSerializationRetry } from "@/lib/serialization";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { createAuditEntryTx } from "@/lib/audit";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { recomputeFutureAssignmentAvailabilityConflictsForUser } from "@/lib/services/availability-conflict-recompute";
import { z } from "zod";
import { parseDateOnly, assertBlockShape, normalizedTimes, availabilityDateSchema, availabilityTimeSchema } from "../_shared";

const updateBlockSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  kind:             z.enum(["WEEKLY", "AD_HOC"]).default("WEEKLY"),
  intent:           z.enum(["CANNOT_WORK", "PREFER", "DISLIKE", "TIME_OFF"]).default("CANNOT_WORK"),
  status:           z.enum(["APPROVED", "PENDING", "DENIED"]).optional(),
  dayOfWeek:        z.number().int().min(0).max(6).optional().nullable(),
  date:             availabilityDateSchema.optional().nullable(),
  dateEndsOn:       availabilityDateSchema.optional().nullable(),
  allDay:           z.boolean().optional().default(false),
  startsAt:         availabilityTimeSchema,
  endsAt:           availabilityTimeSchema,
  label:            z.string().trim().max(80).optional().nullable(),
  semesterLabel:    z.string().trim().max(40).optional().nullable(),
  semesterStartsOn: availabilityDateSchema.optional().nullable(),
  semesterEndsOn:   availabilityDateSchema.optional().nullable(),
  reviewNote:       z.string().trim().max(500).optional().nullable(),
});

async function findOwnedBlock(id: string, blockId: string, client: Prisma.TransactionClient) {
  const block = await client.studentAvailabilityBlock.findUnique({
    where: { id: blockId },
  });

  if (!block) throw new HttpError(404, "Block not found");
  if (block.userId !== id) throw new HttpError(404, "Block not found");
  return block;
}

function auditShape(block: Awaited<ReturnType<typeof findOwnedBlock>>) {
  return {
    userId: block.userId,
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
  };
}

async function notifyTimeOffReview(
  block: Awaited<ReturnType<typeof findOwnedBlock>>,
  status: "APPROVED" | "DENIED",
  client: Prisma.TransactionClient,
) {
  const approved = status === "APPROVED";
  const title = approved ? "Time off approved" : "Time off denied";
  const body = block.label
    ? `Your time-off request "${block.label}" was ${approved ? "approved" : "denied"}.`
    : `Your time-off request was ${approved ? "approved" : "denied"}.`;
  const pushBody = approved ? "Staff will see it when scheduling." : "Talk to staff if you still need the time.";

  const payload = {
    availabilityBlockId: block.id,
    href: `/staff/${block.userId}?tab=availability`,
  };
  // Each new review cycle gets its own notification; a resubmitted request
  // must not be silenced by an earlier approval of different dates.
  const [row] = await client.notification.createManyAndReturn({
    data: [{
      userId: block.userId,
      type: status === "APPROVED" ? "time_off_approved" : "time_off_denied",
      title,
      body,
      payload,
      channel: "IN_APP",
      sentAt: new Date(),
      dedupeKey: `availability:${block.id}:${status.toLowerCase()}:${block.updatedAt.toISOString()}`,
    }],
    skipDuplicates: true,
    select: { id: true },
  });
  return row ? {
      title,
      subtitle: block.label ?? undefined,
      body: pushBody,
      payload,
      category: "timeOff" as const,
      notificationId: row.id,
    } : null;
}

export const PATCH = withAuth<{ id: string; blockId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "student_availability", "edit");
  const { id, blockId } = params;

  if (user.role === "STUDENT" && user.id !== id) {
    throw new HttpError(403, "Forbidden");
  }
  await enforceRateLimit(`availability:${user.id}`, SETTINGS_MUTATION_LIMIT);

  const input = z.union([
    updateBlockSchema,
    z.object({
      status: z.enum(["APPROVED", "DENIED"]),
      reviewNote: z.string().trim().max(500).nullable().optional(),
      expectedUpdatedAt: z.string().datetime().optional(),
    }).strict(),
  ]).parse(await req.json());
  const staffReview = user.role === "ADMIN" || user.role === "STAFF";
  const { block, push } = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const existing = await findOwnedBlock(id, blockId, tx);
    if (input.expectedUpdatedAt && existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new HttpError(409, "This availability changed. Close the editor and reopen the latest entry before saving or reviewing.");
    }
    const reviewOnly = !("startsAt" in input);
    if (reviewOnly) {
      requirePermission(user.role, "student_availability", "review");
      if (existing.intent !== "TIME_OFF") throw new HttpError(400, "Only time-off requests can be reviewed");
    }
    const body = reviewOnly ? updateBlockSchema.parse({
      ...existing,
      date: existing.date ? availabilityDateKey(existing.date) : null,
      dateEndsOn: existing.dateEndsOn ? availabilityDateKey(existing.dateEndsOn) : null,
      semesterStartsOn: existing.semesterStartsOn ? availabilityDateKey(existing.semesterStartsOn) : null,
      semesterEndsOn: existing.semesterEndsOn ? availabilityDateKey(existing.semesterEndsOn) : null,
      ...input,
    }) : input;
    assertBlockShape(body);
    if (!staffReview && body.reviewNote?.trim()) {
      throw new HttpError(403, "Only staff can write review notes");
    }
    if (!staffReview && body.status && body.status !== existing.status) {
      throw new HttpError(403, "Only staff can review time-off requests");
    }
    const status = body.intent === "TIME_OFF"
      ? staffReview ? body.status ?? existing.status : "PENDING"
      : "APPROVED";
    const reviewed = body.intent === "TIME_OFF" && staffReview && status !== "PENDING";
    const times = normalizedTimes(body);

    const block = await tx.studentAvailabilityBlock.update({
      where: { id: blockId },
      data: {
        kind:             body.kind,
        intent:           body.intent,
        status,
        dayOfWeek:        body.kind === "WEEKLY" ? body.dayOfWeek : null,
        date:             body.kind === "AD_HOC" ? parseDateOnly(body.date) : null,
        dateEndsOn:       body.kind === "AD_HOC" ? parseDateOnly(body.dateEndsOn ?? body.date) : null,
        allDay:           body.kind === "AD_HOC" ? body.allDay : false,
        startsAt:         times.startsAt,
        endsAt:           times.endsAt,
        label:            body.label?.trim() || null,
        semesterLabel:    body.semesterLabel?.trim() || null,
        semesterStartsOn: parseDateOnly(body.semesterStartsOn),
        semesterEndsOn:   parseDateOnly(body.semesterEndsOn),
        reviewedAt:       reviewed ? new Date() : null,
        reviewedById:     reviewed ? user.id : null,
        reviewNote:       reviewed ? (body.reviewNote === undefined ? existing.reviewNote : body.reviewNote?.trim() || null) : null,
      },
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "student_availability_block",
      entityId: blockId,
      action: "student_availability_updated",
      before: auditShape(existing),
      after: auditShape(block),
    });

    let push: Awaited<ReturnType<typeof notifyTimeOffReview>> = null;
    if (
      staffReview &&
      existing.intent === "TIME_OFF" &&
      block.intent === "TIME_OFF" &&
      existing.status !== block.status &&
      (block.status === "APPROVED" || block.status === "DENIED")
    ) {
      push = await notifyTimeOffReview(block, block.status, tx);
    }

    await recomputeFutureAssignmentAvailabilityConflictsForUser(id, { client: tx });
    return { block, push };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }));
  if (push) deferPush(sendPushToUser(block.userId, push));
  return ok({ data: block });
});

export const DELETE = withAuth<{ id: string; blockId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "student_availability", "delete");
  const { id, blockId } = params;

  if (user.role === "STUDENT" && user.id !== id) {
    throw new HttpError(403, "Forbidden");
  }
  await enforceRateLimit(`availability:${user.id}`, SETTINGS_MUTATION_LIMIT);

  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const block = await findOwnedBlock(id, blockId, tx);

    await tx.studentAvailabilityBlock.delete({ where: { id: blockId } });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "student_availability_block",
      entityId: blockId,
      action: "student_availability_deleted",
      before: auditShape(block),
    });

    await recomputeFutureAssignmentAvailabilityConflictsForUser(id, { client: tx });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }));

  return ok({ data: null });
});
