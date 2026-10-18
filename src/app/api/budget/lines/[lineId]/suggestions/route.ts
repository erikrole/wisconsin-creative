import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { suggestItemsForLine } from "@/lib/services/budget";

/** Inventory that might have come from this budget line, best match first. */
export const GET = withAuth<{ lineId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "budget", "view");
  return ok({ data: await suggestItemsForLine(params.lineId) });
});
