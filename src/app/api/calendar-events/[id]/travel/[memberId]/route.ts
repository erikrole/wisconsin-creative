import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";

export const DELETE = withAuth<{ id: string; memberId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`event-travel:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const { id, memberId } = params;

  const member = await db.eventTravelMember.findUnique({
    where: { id: memberId },
    select: {
      eventId: true,
      userId: true,
      notes: true,
      user: { select: { name: true } },
    },
  });

  if (!member) throw new HttpError(404, "Travel member not found");
  if (member.eventId !== id) throw new HttpError(404, "Travel member not found");

  // Scoped deleteMany instead of delete: a concurrent remove leaves nothing to
  // delete, which is the outcome the caller wanted, not a P2025 500.
  const { count } = await db.eventTravelMember.deleteMany({ where: { id: memberId, eventId: id } });
  if (count === 0) return ok({ data: null });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "calendar_event",
    entityId: id,
    action: "event_travel_member_removed",
    before: {
      travelMemberId: memberId,
      userId: member.userId,
      userName: member.user.name,
      notes: member.notes,
    },
  });

  return ok({ data: null });
});
