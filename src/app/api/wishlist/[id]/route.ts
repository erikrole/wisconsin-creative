import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { deleteWish, updateWish } from "@/lib/services/wishlist";
import { updateWishSchema } from "@/lib/wishlist/schemas";

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "wish", "create");
  await enforceRateLimit(`wish:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = updateWishSchema.parse(await req.json());
  return ok({ data: await updateWish(user, params.id, input) });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "wish", "create");
  await enforceRateLimit(`wish:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  return ok({ data: await deleteWish(user, params.id) });
});
