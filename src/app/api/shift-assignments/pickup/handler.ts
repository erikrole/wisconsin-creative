import type { AuthUser } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { ok } from "@/lib/http";
import { deferPush, dispatchScheduleAssignmentNotifications, notifyPickupRequestReviewers } from "@/lib/services/notifications";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { enqueuePendingClaimReview } from "@/lib/claim-review-workflow";
import { pickupOpenShift } from "@/lib/services/schedule-open-work";
import { requestShiftSchema } from "@/lib/validation";

export async function handleOpenShiftPickup(
  req: Request,
  { user }: { user: AuthUser },
) {
  requirePermission(user.role, "shift_assignment", "request");
  await enforceRateLimit(`shift-pickup:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const body = requestShiftSchema.parse(await req.json());
  const assignment = await pickupOpenShift(body.shiftId, user.id);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "shift_assignment",
    entityId: assignment.id,
    action: "shift_pickup_requested",
    after: {
      shiftId: body.shiftId,
      status: assignment.status,
      hasConflict: assignment.hasConflict,
      conflictNote: assignment.conflictNote,
    },
  });

  // "requested", not "assigned": the student holds nothing until Admin approves,
  // and the copy has to say so.
  // Deferred past the response but kept alive until they settle; a bare
  // promise can be frozen mid-send once the response is written.
  deferPush(dispatchScheduleAssignmentNotifications(assignment.id, "requested").catch(() => {}));
  deferPush(notifyPickupRequestReviewers(assignment.id).catch(() => {}));
  deferPush(enqueuePendingClaimReview({
    kind: "request",
    claimId: assignment.id,
    shiftStartsAt: assignment.callStartsAt
      ?? assignment.shift.callStartsAt
      ?? assignment.shift.startsAt,
  }).then(() => {}, () => {}));

  return ok({ data: assignment }, 201);
}
