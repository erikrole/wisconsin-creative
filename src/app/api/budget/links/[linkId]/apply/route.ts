import { withAuth } from "@/lib/api";
import { applyOrderSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { applyOrderToAsset } from "@/lib/services/budget";

/** Fill an item's purchase date, price, link, or notes from the order it is linked to. */
export const POST = withAuth<{ linkId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = applyOrderSchema.parse(await req.json());
  return ok({ data: await applyOrderToAsset(user, params.linkId, input.fields) });
});
