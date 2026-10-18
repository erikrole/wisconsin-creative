import { withAuth } from "@/lib/api";
import { createLineSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { createLine } from "@/lib/services/budget";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = createLineSchema.parse(await req.json());
  return ok({ data: await createLine(user, params.id, input) }, 201);
});
