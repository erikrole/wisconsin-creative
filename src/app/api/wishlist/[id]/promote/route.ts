import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { promoteWish } from "@/lib/services/wishlist";
import { promoteWishSchema } from "@/lib/wishlist/schemas";

/** Admin only: move a wish into a budget as a planned line. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "wish", "manage");
  await enforceRateLimit(`wish:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = promoteWishSchema.parse(await req.json());
  return ok({ data: await promoteWish(user, params.id, input) }, 201);
});
