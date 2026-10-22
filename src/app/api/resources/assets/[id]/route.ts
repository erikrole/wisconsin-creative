import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { getResourceAsset } from "@/lib/resource-assets";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermissionOrCollaboratorCapability(user, "resource", "view", "BRAND_ASSETS_VIEW");
  const data = await getResourceAsset(params.id, user.id);
  return ok({ data });
});
