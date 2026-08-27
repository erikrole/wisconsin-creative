import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { toggleResourceAssetFavorite } from "@/lib/resource-assets";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "resource", "favorite");
  const data = await toggleResourceAssetFavorite({
    actorId: user.id,
    actorRole: user.role,
    assetId: params.id,
  });
  return ok({ data });
});
