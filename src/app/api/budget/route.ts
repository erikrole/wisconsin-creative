import { withAuth } from "@/lib/api";
import { createBudgetSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { createBudget, listBudgets } from "@/lib/services/budget";

/** Every budget (one per name and fiscal year). Admin only. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "budget", "view");
  return ok({ data: await listBudgets() });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = createBudgetSchema.parse(await req.json());
  return ok({ data: await createBudget(user, input) }, 201);
});
