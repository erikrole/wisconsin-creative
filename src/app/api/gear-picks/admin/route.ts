import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { applyGearPicksAdminChange, getGearPicksAdmin } from "@/lib/services/gear-picks";

const fitSchema = z.enum(["MEN", "WOMEN"]);
// Allowances are whole cents, capped at $2,000 so a typo can't create an unbounded budget.
const allowanceSchema = z.number().int().min(0).max(200_000);

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setDeadline"),
    deadline: z.string().datetime({ offset: true }).nullable(),
  }),
  z.object({
    action: z.literal("setLaunched"),
    launched: z.boolean(),
  }),
  z.object({
    action: z.literal("addParticipant"),
    userId: z.string().trim().min(1).max(64),
    fit: fitSchema,
    allowanceCents: allowanceSchema.optional(),
  }),
  z.object({
    action: z.literal("updateParticipant"),
    participantId: z.string().trim().min(1).max(64),
    fit: fitSchema.optional(),
    allowanceCents: allowanceSchema.optional(),
  }),
  z.object({
    action: z.literal("removeParticipant"),
    participantId: z.string().trim().min(1).max(64),
  }),
]).superRefine((value, ctx) => {
  if (value.action === "updateParticipant" && value.fit === undefined && value.allowanceCents === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Change the fit or the allowance", path: ["fit"] });
  }
});

/** Admin results: every participant's status and lines, plus totals by item, color, and size. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  return ok({ data: await getGearPicksAdmin() });
});

/** Admin changes: set the deadline, or add, update, or remove a participant. */
export const PATCH = withAuth(async (req, { user }) => {
  requirePermission(user.role, "gear_picks", "manage");
  await enforceRateLimit(`gear-picks:admin:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const change = patchSchema.parse(await req.json());
  const result = await applyGearPicksAdminChange(user, change);
  return ok({ data: result });
});
