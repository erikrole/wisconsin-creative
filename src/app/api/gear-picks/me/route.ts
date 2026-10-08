import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { GEAR_MAX_QUANTITY, GEAR_SIZE_MAX_LENGTH } from "@/lib/gear-picks/catalog";
import { getMyGearPicks, saveMyGearPicks } from "@/lib/services/gear-picks";

const MAX_LINES = 80;

const putSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(40),
        size: z.string().trim().max(GEAR_SIZE_MAX_LENGTH).nullable().optional(),
        quantity: z.number().int().min(1).max(GEAR_MAX_QUANTITY),
      }),
    )
    .max(MAX_LINES),
  submit: z.boolean(),
  version: z.number().int().min(0),
});

/** The signed-in person's gear pick cycle, participation, saved list, and profile size defaults. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "view");
  return ok({ data: await getMyGearPicks(user) });
});

/** Replace the signed-in participant's pick list (draft or submit). Prices come from the catalog. */
export const PUT = withAuth(async (req, { user }) => {
  requirePermission(user.role, "gear_picks", "submit");
  await enforceRateLimit(`gear-picks:save:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = putSchema.parse(await req.json());
  const submission = await saveMyGearPicks({
    actor: user,
    lines: body.lines,
    submit: body.submit,
    version: body.version,
  });
  return ok({ data: submission });
});
