import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { badges } from "@/lib/badges";
import { EVENT_CREDIT_NOTE_MAX, listEventCredits } from "@/lib/services/event-credit";

const createSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(EVENT_CREDIT_NOTE_MAX).optional(),
}).strict();

/** Who is credited for this event. Read is staff-and-admin; writing is admin-only. */
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "event_credit", "view");

  const event = await db.calendarEvent.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!event) throw new HttpError(404, "Event not found");

  return ok({ data: await listEventCredits(params.id) });
});

/**
 * Credit a person for this event. Deliberately silent: no notification, no
 * shift, no assignment, no schedule entry. The person's Scoreboard totals move;
 * nothing else about their week does.
 *
 * The badge recount that follows is silent too: a badge the credit pushed the
 * person over is granted without its "badge earned" notification, which is the
 * only message a credit could otherwise produce.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "event_credit", "manage");
  await enforceRateLimit(`event-credit:write:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const rawBody = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const body = createSchema.parse(rawBody);

  let creditedUserId: string | null = null;

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

    const existing = await tx.eventCredit.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: target.id } },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, `${target.name} is already credited for this event`);

    const credit = await tx.eventCredit.create({
      data: {
        eventId: event.id,
        userId: target.id,
        note: body.note || null,
        createdById: user.id,
      },
      select: { id: true },
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: event.id,
      action: "event_credit_added",
      after: {
        creditId: credit.id,
        userId: target.id,
        userName: target.name,
        userRole: target.role,
        eventSummary: event.summary,
        eventStartsAt: event.startsAt.toISOString(),
        note: body.note || null,
      },
    });

    // Only a finished event is worked evidence; a credit on a future one is
    // picked up by the nightly sweep after the event actually ends.
    if (event.endsAt < new Date()) creditedUserId = target.id;
  });

  // Outside the audit transaction: badge evaluation opens its own serializable
  // transaction, and a recognition failure must not roll back the credit. The
  // evaluator suppresses notifications for anything only this credit earned.
  if (creditedUserId) await badges.onShiftsWorked({ userId: creditedUserId });

  return ok({ data: await listEventCredits(params.id) });
});
