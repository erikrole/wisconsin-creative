import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { toggleResourceAssetFavorite } from "@/lib/resource-assets";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermissionOrCollaboratorCapability(user, "resource", "favorite", "BRAND_ASSETS_VIEW");
  const data = await toggleResourceAssetFavorite({
    actorId: user.id,
    actorRole: user.role,
    assetId: params.id,
  });
  return ok({ data });
});
