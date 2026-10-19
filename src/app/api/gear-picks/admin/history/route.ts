import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { archiveCurrentGearCycle, getGearPastCycles } from "@/lib/services/gear-picks";

/** Past years of UA gear, newest first. Read-only, admin only. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  return ok({ data: { cycles: await getGearPastCycles() } });
});

/** Save the live year to History, replacing any earlier snapshot of the same year. */
export const POST = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  await enforceRateLimit(`gear-picks:archive:${user.id}`, SETTINGS_MUTATION_LIMIT);
  return ok({ data: await archiveCurrentGearCycle(user) });
});
