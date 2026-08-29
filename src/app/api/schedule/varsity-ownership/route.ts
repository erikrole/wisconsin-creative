import { Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission, requireRole } from "@/lib/rbac";
import { getVarsityOwnership, handoffVarsityOwnership, varsityOwnershipHandoffSchema } from "@/lib/services/varsity-season-ownership";

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "sport_config", "manage");
  requireRole(user.role, [Role.ADMIN]);
  await enforceRateLimit(`varsity-ownership:read:${user.id}`, { max: 60, windowMs: 60_000 });
  return ok({ data: await getVarsityOwnership(new URL(req.url).searchParams.get("sportCode") ?? "") });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "sport_config", "manage");
  requireRole(user.role, [Role.ADMIN]);
  await enforceRateLimit(`varsity-ownership:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = varsityOwnershipHandoffSchema.parse(await req.json());
  return ok({ data: await handoffVarsityOwnership(input, user) });
});
