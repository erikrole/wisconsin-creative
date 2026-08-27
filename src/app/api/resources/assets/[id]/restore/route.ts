import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  restoreResourceAssetVersion,
  restoreResourceAssetVersionSchema,
} from "@/lib/resource-assets";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "resource", "edit");
  const body = restoreResourceAssetVersionSchema.parse(await req.json());
  const data = await restoreResourceAssetVersion({
    ...body,
    assetId: params.id,
    actorId: user.id,
    actorRole: user.role,
  });
  return ok({ data });
});
