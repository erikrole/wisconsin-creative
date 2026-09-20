import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getScheduleOpenWork, parseAreaFilter } from "@/lib/services/schedule-open-work";

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift_trade", "view");

  const url = new URL(req.url);
  const area = parseAreaFilter(url.searchParams.get("area"));
  const work = await getScheduleOpenWork({
    userId: user.id,
    role: user.role,
    area,
    limit: 100,
  });

  return ok({ data: work });
});
