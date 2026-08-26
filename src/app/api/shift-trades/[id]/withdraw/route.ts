import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withdrawTradeClaim } from "@/lib/services/shift-trades";

export const PATCH = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "shift_trade", "claim");
  await enforceRateLimit(`shift-trade:withdraw:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const trade = await withdrawTradeClaim(params.id, { id: user.id, role: user.role });
  return ok({ data: trade });
});
