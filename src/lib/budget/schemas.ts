import { z } from "zod";
import { AUTOFILL_FIELDS } from "@/lib/budget/autofill";
import { BUDGET_CATEGORIES, BUDGET_LINE_STATUSES, FISCAL_YEAR_PATTERN, MAX_BUDGET_CENTS } from "@/lib/budget/contract";

const cents = z.number().int().min(0).max(MAX_BUDGET_CENTS);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();
const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || /^https?:\/\//i.test(value), "Links must start with http:// or https://")
  .nullable();
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-05-14")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That date doesn't exist")
  .nullable();

export const createBudgetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  fiscalYear: z.string().trim().regex(FISCAL_YEAR_PATTERN, "Use a fiscal year like 2026-27"),
  allocationCents: cents.nullable().optional(),
  notes: optionalText(2000).optional(),
  /** Copy this budget's recurring lines in as planned lines for the new year. */
  copyRecurringFromBudgetId: z.string().trim().min(1).max(64).optional(),
});

export const updateBudgetSchema = z
  .object({
    allocationCents: cents.nullable().optional(),
    notes: optionalText(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

const lineFields = {
  category: z.enum(BUDGET_CATEGORIES),
  status: z.enum(BUDGET_LINE_STATUSES),
  description: z.string().trim().min(1).max(200),
  supplier: optionalText(120),
  unitCostCents: cents,
  quantity: z.number().int().min(1).max(10_000),
  quantityBought: z.number().int().min(0).max(10_000).nullable(),
  spentCents: cents.nullable(),
  purchasedOn: dateOnly,
  orderNumber: optionalText(80),
  poNumber: optionalText(80),
  linkUrl: optionalUrl,
  justification: optionalText(2000),
  requesterUserId: z.string().trim().min(1).max(64).nullable(),
  requesterNote: optionalText(200),
  unplanned: z.boolean(),
  refundCents: cents.nullable(),
  recurring: z.boolean(),
};

export const createLineSchema = z.object({
  ...lineFields,
  status: lineFields.status.default("PLANNED"),
  supplier: lineFields.supplier.optional(),
  quantity: lineFields.quantity.default(1),
  quantityBought: lineFields.quantityBought.optional(),
  spentCents: lineFields.spentCents.optional(),
  purchasedOn: lineFields.purchasedOn.optional(),
  orderNumber: lineFields.orderNumber.optional(),
  poNumber: lineFields.poNumber.optional(),
  linkUrl: lineFields.linkUrl.optional(),
  justification: lineFields.justification.optional(),
  requesterUserId: lineFields.requesterUserId.optional(),
  requesterNote: lineFields.requesterNote.optional(),
  unplanned: lineFields.unplanned.default(false),
  refundCents: lineFields.refundCents.optional(),
  recurring: lineFields.recurring.default(false),
});

export const updateLineSchema = z
  .object(lineFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type CreateLineInput = z.infer<typeof createLineSchema>;
export type UpdateLineInput = z.infer<typeof updateLineSchema>;

const id = z.string().trim().min(1).max(64);

/** Link a line to exactly one serialized asset or one bulk SKU. */
export const linkItemSchema = z
  .object({
    assetId: id.optional(),
    bulkSkuId: id.optional(),
    quantity: z.number().int().min(1).max(100_000).optional(),
  })
  .refine((value) => (value.assetId === undefined) !== (value.bulkSkuId === undefined), "Choose an item or a bulk item");

export const applyOrderSchema = z.object({
  fields: z.array(z.enum(AUTOFILL_FIELDS)).min(1).max(AUTOFILL_FIELDS.length),
});

/** Change several lines at once: drop or restore them, or move them to another category. */
export const bulkLinesSchema = z
  .object({
    lineIds: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
    status: z.enum(BUDGET_LINE_STATUSES).optional(),
    category: z.enum(BUDGET_CATEGORIES).optional(),
  })
  .refine((value) => value.status !== undefined || value.category !== undefined, "Nothing to change");
export type BulkLinesInput = z.infer<typeof bulkLinesSchema>;
