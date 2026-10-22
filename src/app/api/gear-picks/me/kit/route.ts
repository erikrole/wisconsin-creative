import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getMyGearKit } from "@/lib/services/gear-picks";

/** The signed-in person's own kit and what has been handed to them. Null when they are not on this year's list. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "view");
  return ok({ data: { kit: await getMyGearKit(user) } });
});
