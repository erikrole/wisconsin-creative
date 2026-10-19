import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { createWish, listWishes } from "@/lib/services/wishlist";
import { createWishSchema } from "@/lib/wishlist/schemas";

/** Every wish. Staff and admins see all of them. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "wish", "view");
  return ok({ data: await listWishes() });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "wish", "create");
  await enforceRateLimit(`wish:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = createWishSchema.parse(await req.json());
  return ok({ data: await createWish(user, input) }, 201);
});
