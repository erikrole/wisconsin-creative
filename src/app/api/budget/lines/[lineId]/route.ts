import { withAuth } from "@/lib/api";
import { updateLineSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { deleteLine, updateLine } from "@/lib/services/budget";

export const PATCH = withAuth<{ lineId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = updateLineSchema.parse(await req.json());
  return ok({ data: await updateLine(user, params.lineId, input) });
});

export const DELETE = withAuth<{ lineId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  return ok({ data: await deleteLine(user, params.lineId) });
});
