import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { normalizeOtsControl, OTS_CONTROL_KEY } from "@/lib/services/ots-control";

/** GET /api/ots/control/staff: the full control state, including who changed it last, for the controller page. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "ots_board", "control");
  const row = await db.systemConfig.findUnique({ where: { key: OTS_CONTROL_KEY } });
  return ok({ data: normalizeOtsControl(row?.value) });
});
