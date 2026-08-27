import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { approveRequest } from "@/lib/services/shift-assignments";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";

export const PATCH = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift_assignment", "approve");
  // Same budget its decline sibling and both trade review routes carry: an
  // approval writes an assignment and fans out notifications, so it is the
  // heavier of the pair, not the one to leave unmetered.
  await enforceRateLimit(`shift-request:review:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const { id } = params;

  const assignment = await approveRequest(id, { id: user.id, role: user.role });

  return ok({ data: assignment });
});
