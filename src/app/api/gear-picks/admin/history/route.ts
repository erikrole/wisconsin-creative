import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getGearPastCycles } from "@/lib/services/gear-picks";

/** Past years of UA gear, newest first. Read-only, admin only. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  return ok({ data: { cycles: await getGearPastCycles() } });
});
