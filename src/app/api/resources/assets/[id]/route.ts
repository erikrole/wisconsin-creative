import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getResourceAsset } from "@/lib/resource-assets";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "resource", "view");
  const data = await getResourceAsset(params.id, user.id);
  return ok({ data });
});
