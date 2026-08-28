import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { matchSportSetup } from "@/lib/services/sport-setup";
import { sportCodeSchema } from "@/lib/validation";

const matchSchema = z.object({
  sourceSportCode: sportCodeSchema,
  targetSportCode: sportCodeSchema,
  includeRoster: z.boolean().default(false),
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "sport_config", "manage");
  requirePermission(user.role, "student_sport", "manage");
  await enforceRateLimit(`sport-setup:match:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const input = matchSchema.parse(await req.json());
  return ok({ data: await matchSportSetup({ ...input, actor: user }) });
});
