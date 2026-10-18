import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { suggestLinesForAsset } from "@/lib/services/budget";

/** The budget lines linked to an item, or the ones that probably paid for it. Admin only. */
export const GET = withAuth<{ assetId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "budget", "view");
  return ok({ data: await suggestLinesForAsset(params.assetId) });
});
