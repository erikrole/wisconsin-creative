import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getLineHistory } from "@/lib/services/budget";

export const GET = withAuth<{ lineId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "budget", "view");
  return ok({ data: await getLineHistory(params.lineId) });
});
