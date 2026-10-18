import { withAuth } from "@/lib/api";
import { bulkLinesSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { bulkUpdateLines } from "@/lib/services/budget";

/** Drop, restore, or recategorize several lines at once; the response holds what to restore on undo. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = bulkLinesSchema.parse(await req.json());
  return ok({ data: await bulkUpdateLines(user, params.id, input) });
});
