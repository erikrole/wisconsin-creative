import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getGearPicksForUser } from "@/lib/services/gear-picks";

/** One person's gear picks for their profile tab: themselves, or anyone for admins. */
export const GET = withAuth<{ userId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "gear_picks", "view");
  if (params.userId !== user.id) requirePermission(user.role, "gear_picks", "manage");
  return ok({ data: await getGearPicksForUser(params.userId, user) });
});
