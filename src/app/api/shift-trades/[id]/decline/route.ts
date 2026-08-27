import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { declineTrade } from "@/lib/services/shift-trades";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";

export const PATCH = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift_trade", "approve");
  await enforceRateLimit(`shift-trade:review:${user.id}`, SCHEDULE_MUTATION_LIMIT);
  const { id } = params;

  // The audit entry is written inside the service transaction, alongside the
  // status change and the claimer it clears — same as approve.
  const trade = await declineTrade(id, { id: user.id, role: user.role });

  return ok({ data: trade });
});
