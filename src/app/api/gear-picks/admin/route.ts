import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { applyGearPicksAdminChange, getGearPicksAdmin } from "@/lib/services/gear-picks";

const fitSchema = z.enum(["MEN", "WOMEN"]);
// Allowances are whole cents, capped at $2,000 so a typo can't create an unbounded budget.
const allowanceSchema = z.number().int().min(0).max(200_000);
const isoDate = z.string().datetime({ offset: true });

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
    action: z.literal("setBudget"),
    // Whole cents, up to $1,000,000, so a typo can't create an unbounded budget.
    budgetCents: z.number().int().min(0).max(100_000_000),
    confirmed: z.boolean(),
    // Per-student kit price in whole cents, up to $1,000.
    studentKitCents: z.number().int().min(0).max(100_000).optional(),
  }),
  z.object({
    action: z.literal("setOrder"),
    placedAt: isoDate.nullable(),
    poNumber: z.string().trim().min(1).max(60).nullable(),
    orderNumber: z.string().trim().min(1).max(60).nullable(),
    expectedAt: isoDate.nullable(),
  }),
  z.object({
    action: z.literal("addReceipt"),
    sku: z.string().trim().regex(/^\d{6,8}-\d{3}$/),
    size: z.string().trim().min(1).max(12).nullable(),
    quantity: z.number().int().min(1).max(500),
    receivedAt: isoDate,
    note: z.string().trim().max(200).nullable().optional(),
  }),
  z.object({
    action: z.literal("removeReceipt"),
    receiptId: z.string().trim().min(1).max(64),
  }),
  z.object({
    action: z.literal("setHandout"),
    userId: z.string().trim().min(1).max(64),
    handed: z.boolean(),
    pieces: z
      .array(
        z.object({
          sku: z.string().trim().regex(/^\d{6,8}-\d{3}$/),
          size: z.string().trim().min(1).max(12),
          source: z.enum(["STANDARD_ISSUE", "CORE_KIT", "STUDENT_KIT", "PICK"]),
          quantity: z.number().int().min(1).max(50),
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({
    action: z.literal("addStudent"),
    userId: z.string().trim().min(1).max(64),
  }),
  z.object({
    action: z.literal("removeStudent"),
    studentId: z.string().trim().min(1).max(64),
  }),
  z.object({
    action: z.literal("setStudentSizes"),
    studentId: z.string().trim().min(1).max(64),
    topSize: z.string().trim().min(1).max(40).nullable(),
    shoeSize: z.string().trim().min(1).max(40).nullable(),
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
