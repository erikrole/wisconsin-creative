import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { getSportSetup } from "@/lib/services/sport-setup";
import { setSportAutoAssignPolicy } from "@/lib/services/sport-auto-assign-policies";
import { SPORT_AUTO_ASSIGN_POLICIES } from "@/lib/sport-auto-assign-policy";
import { sportCodeSchema } from "@/lib/validation";

const policySchema = z.object({
  sportCode: sportCodeSchema,
  policy: z.enum(SPORT_AUTO_ASSIGN_POLICIES),
});

export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "sport_config", "view");
  await enforceRateLimit(`sport-setup:read:${user.id}`, { max: 60, windowMs: 60_000 });
  return ok({ data: await getSportSetup() });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "sport_config", "manage");
  await enforceRateLimit(`sport-setup:policy:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const { sportCode, policy } = policySchema.parse(await req.json());
  const updated = await setSportAutoAssignPolicy(sportCode, policy);
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "sport_config",
    entityId: sportCode,
    action: "sport_auto_assign_policy_set",
    after: { sportCode, policy },
  });
  return ok({ data: updated });
});
