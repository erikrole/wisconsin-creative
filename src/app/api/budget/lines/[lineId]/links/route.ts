import { withAuth } from "@/lib/api";
import { linkItemSchema } from "@/lib/budget/schemas";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { linkItem } from "@/lib/services/budget";

export const POST = withAuth<{ lineId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "budget", "manage");
  await enforceRateLimit(`budget:mutate:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = linkItemSchema.parse(await req.json());
  const target = input.assetId
    ? { assetId: input.assetId, quantity: input.quantity }
    : { bulkSkuId: input.bulkSkuId as string, quantity: input.quantity };
  return ok({ data: await linkItem(user, params.lineId, target) }, 201);
});
