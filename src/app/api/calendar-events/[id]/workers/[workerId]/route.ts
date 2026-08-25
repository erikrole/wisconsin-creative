import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { listEventWorkers } from "@/lib/services/event-worker";

/**
 * Remove an added worker. Silent in the same way adding one is.
 *
 * No badge recount follows: badges are never revoked, here or anywhere else, so
 * a recount after a removal could only re-confirm what the person already
 * holds. Scoreboard and record totals do drop, because they are read live.
 */
export const DELETE = withAuth<{ id: string; workerId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "event_worker", "manage");
  await enforceRateLimit(`event-worker:write:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  await db.$transaction(async (tx) => {
    const worker = await tx.eventWorker.findUnique({
      where: { id: params.workerId },
      select: {
        id: true,
        eventId: true,
        note: true,
        user: { select: { id: true, name: true, role: true } },
        event: { select: { summary: true, startsAt: true } },
      },
    });
    if (!worker || worker.eventId !== params.id) throw new HttpError(404, "Worker not found");

    await tx.eventWorker.delete({ where: { id: worker.id } });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: worker.eventId,
      action: "event_worker_removed",
      before: {
        workerId: worker.id,
        userId: worker.user.id,
        userName: worker.user.name,
        userRole: worker.user.role,
        eventSummary: worker.event.summary,
        eventStartsAt: worker.event.startsAt.toISOString(),
        note: worker.note,
      },
    });
  });

  return ok({ data: await listEventWorkers(params.id) });
});
