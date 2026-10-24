import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import { refreshFootballResults } from "@/lib/services/football-results";

export const maxDuration = 60;

export const POST = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "calendar_source", "sync");
  await enforceRateLimit(`football-results:${user.id}`, { max: 2, windowMs: 60_000 });
  return ok({ data: await refreshFootballResults({ id: user.id, role: user.role }) });
});
