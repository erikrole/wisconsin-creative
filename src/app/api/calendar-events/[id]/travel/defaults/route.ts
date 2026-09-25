import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { loadTravelEvent, travelerUserWhere, travelMemberInclude } from "@/lib/services/event-travel";

/**
 * Adds the sport's default travelers to this away game in one step. People
 * already on the roster are left alone, so it is safe to press again after
 * editing the list, and the result is always the full roster.
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`event-travel:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const event = await loadTravelEvent(params.id);

  const defaults = await db.studentSportAssignment.findMany({
    where: { sportCode: event.sportCode, defaultTraveler: true, user: travelerUserWhere() },
    select: { userId: true, user: { select: { name: true } } },
  });

  // The @@unique([eventId, userId]) constraint decides who is new, so two
  // staff pressing this at once cannot double-add anyone.
  const { count } = defaults.length === 0
    ? { count: 0 }
    : await db.eventTravelMember.createMany({
        data: defaults.map((d) => ({ eventId: event.id, userId: d.userId })),
        skipDuplicates: true,
      });

  const members = await db.eventTravelMember.findMany({
    where: { eventId: event.id },
    include: travelMemberInclude,
    orderBy: { createdAt: "asc" },
  });

  if (count > 0) {
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "calendar_event",
      entityId: event.id,
      action: "event_travel_defaults_added",
      after: {
        sportCode: event.sportCode,
        addedCount: count,
        defaultTravelerIds: defaults.map((d) => d.userId),
        eventSummary: event.summary,
      },
    });
  }

  return ok({ data: members, added: count, defaultCount: defaults.length });
});
