import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { badges } from "@/lib/badges";
import { EVENT_WORKER_NOTE_MAX, listEventWorkers } from "@/lib/services/event-worker";

const createSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(EVENT_WORKER_NOTE_MAX).optional(),
}).strict();

/** Workers added to this event. Read is staff-and-admin; writing is admin-only. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "event_worker", "view");

  const event = await db.calendarEvent.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!event) throw new HttpError(404, "Event not found");

  return ok({ data: await listEventWorkers(params.id) });
});

/**
 * Add a worker to this event. Deliberately silent: no notification, no shift,
 * no assignment, no schedule entry. The person's Scoreboard totals move;
 * nothing else about their week does.
 *
 * The badge recount that follows is fully silent too: awards still persist, but
 * no badge-earned notification is created, even when the same pass also finds
 * scheduled assignments that cross a threshold.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "event_worker", "manage");
  await enforceRateLimit(`event-worker:write:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const rawBody = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const body = createSchema.parse(rawBody);

  let addedUserId: string | null = null;

  await db.$transaction(async (tx) => {
    const event = await tx.calendarEvent.findUnique({
      where: { id: params.id },
      select: { id: true, summary: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new HttpError(404, "Event not found");

    const target = await tx.user.findUnique({
      where: { id: body.userId },
      select: { id: true, name: true, role: true },
    });
    if (!target) throw new HttpError(404, "User not found");

    // Let the @@unique([eventId, userId]) constraint decide, rather than
    // pre-reading for a duplicate and racing two admins adding the same person
    // -- the same call the travel roster makes on the same shape.
    const worker = await tx.eventWorker.create({
      data: {
        eventId: event.id,
        userId: target.id,
        note: body.note || null,
        addedById: user.id,
      },
      select: { id: true },
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, `${target.name} is already on this event`);
      }
      throw error;
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: event.id,
      action: "event_worker_added",
      after: {
        workerId: worker.id,
        userId: target.id,
        userName: target.name,
        userRole: target.role,
        eventSummary: event.summary,
        eventStartsAt: event.startsAt.toISOString(),
        note: body.note || null,
      },
    });

    // Only a finished event is worked evidence; a worker added to a future one
    // is picked up by the nightly sweep after the event actually ends.
    if (event.endsAt < new Date()) addedUserId = target.id;
  });

  // Outside the audit transaction: badge evaluation opens its own serializable
  // transaction, and a recognition failure must not roll back the row. The
  // explicit option suppresses every badge notification for this backfill,
  // including notifications that an already-scheduled assignment could have
  // produced in the same recount.
  if (addedUserId) await badges.onShiftsWorked({ userId: addedUserId }, { notify: false });

  return ok({ data: await listEventWorkers(params.id) });
});
