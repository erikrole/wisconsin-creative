import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withdrawPickupRequest } from "@/lib/services/schedule-open-work";

export const PATCH = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift_assignment", "request");
  await enforceRateLimit(`shift-request:withdraw:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const assignment = await withdrawPickupRequest(params.id, { id: user.id, role: user.role });
  return ok({ data: assignment });
});
