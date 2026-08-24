import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { listEventCredits } from "@/lib/services/event-credit";

/**
 * Remove a Scoreboard credit. Silent in the same way adding one is.
 *
 * No badge recount follows: badges are never revoked, here or anywhere else, so
 * a recount after a removal could only re-confirm what the person already
 * holds. Scoreboard and record totals do drop, because they are read live.
 */
export const DELETE = withAuth<{ id: string; creditId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "event_credit", "manage");
  await enforceRateLimit(`event-credit:write:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  await db.$transaction(async (tx) => {
    const credit = await tx.eventCredit.findUnique({
      where: { id: params.creditId },
      select: {
        id: true,
        eventId: true,
        note: true,
        user: { select: { id: true, name: true, role: true } },
        event: { select: { summary: true, startsAt: true } },
      },
    });
    if (!credit || credit.eventId !== params.id) throw new HttpError(404, "Credit not found");

    await tx.eventCredit.delete({ where: { id: credit.id } });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: credit.eventId,
      action: "event_credit_removed",
      before: {
        creditId: credit.id,
        userId: credit.user.id,
        userName: credit.user.name,
        userRole: credit.user.role,
        eventSummary: credit.event.summary,
        eventStartsAt: credit.event.startsAt.toISOString(),
        note: credit.note,
      },
    });
  });

  return ok({ data: await listEventCredits(params.id) });
});
