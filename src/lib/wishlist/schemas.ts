import { z } from "zod";
import { BUDGET_CATEGORIES, MAX_BUDGET_CENTS } from "@/lib/budget/contract";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const fields = {
  title: z.string().trim().min(1).max(200),
  linkUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || /^https?:\/\//i.test(value), "Links must start with http:// or https://")
    .nullable(),
  estimateCents: z.number().int().min(0).max(MAX_BUDGET_CENTS).nullable(),
  quantity: z.number().int().min(1).max(10_000),
  neededBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-15")
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), "That date doesn't exist")
    .nullable(),
  reason: optionalText(2000),
};

export const createWishSchema = z.object({
  title: fields.title,
  linkUrl: fields.linkUrl.optional(),
  estimateCents: fields.estimateCents.optional(),
  quantity: fields.quantity.default(1),
  neededBy: fields.neededBy.optional(),
  reason: fields.reason.optional(),
});

/** Anyone who can edit a wish may change these; only admins may also move its status. */
export const updateWishSchema = z
  .object({
    ...fields,
    status: z.enum(["OPEN", "APPROVED", "DECLINED"]),
    statusNote: optionalText(500),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

export const promoteWishSchema = z.object({
  budgetId: z.string().trim().min(1).max(64),
  category: z.enum(BUDGET_CATEGORIES),
  unitCostCents: z.number().int().min(0).max(MAX_BUDGET_CENTS),
  quantity: z.number().int().min(1).max(10_000),
  unplanned: z.boolean().default(false),
});

export type CreateWishInput = z.infer<typeof createWishSchema>;
export type UpdateWishInput = z.infer<typeof updateWishSchema>;
export type PromoteWishInput = z.infer<typeof promoteWishSchema>;
