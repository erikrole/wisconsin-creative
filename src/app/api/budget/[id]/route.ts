import { withAuth } from "@/lib/api";
import { updateBudgetSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { getBudgetDetail, updateBudget } from "@/lib/services/budget";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "budget", "view");
  return ok({ data: await getBudgetDetail(params.id) });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = updateBudgetSchema.parse(await req.json());
  return ok({ data: await updateBudget(user, params.id, input) });
});
