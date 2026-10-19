import { BUDGET_CATEGORY_LABELS, BUDGET_STATUS_LABELS, formatCentsCompact, type BudgetCategoryValue, type BudgetLineStatusValue } from "@/lib/budget/contract";

export type LineChange = { field: string; label: string; from: string; to: string };

type Json = Record<string, unknown> | null | undefined;

const money = (value: unknown) => (typeof value === "number" ? formatCentsCompact(value) : "none");
const text = (value: unknown) => (value === null || value === undefined || value === "" ? "none" : String(value));

const FIELDS: { key: string; label: string; format: (value: unknown) => string }[] = [
  { key: "description", label: "Name", format: text },
  { key: "status", label: "Status", format: (v) => BUDGET_STATUS_LABELS[v as BudgetLineStatusValue] ?? text(v) },
  { key: "category", label: "Category", format: (v) => BUDGET_CATEGORY_LABELS[v as BudgetCategoryValue] ?? text(v) },
  { key: "supplier", label: "Supplier", format: text },
  { key: "unitCostCents", label: "Unit cost", format: money },
  { key: "quantity", label: "Quantity", format: text },
  { key: "spentCents", label: "Spent", format: money },
  { key: "refundCents", label: "Refund", format: money },
  { key: "quantityBought", label: "Quantity bought", format: text },
  { key: "purchasedOn", label: "Ordered", format: text },
  { key: "poNumber", label: "PO", format: text },
  { key: "orderNumber", label: "Order number", format: text },
  { key: "unplanned", label: "Unplanned", format: (v) => (v ? "yes" : "no") },
  { key: "recurring", label: "Repeats yearly", format: (v) => (v ? "yes" : "no") },
  { key: "linkUrl", label: "Link", format: text },
  { key: "justification", label: "Why", format: text },
];

/** The fields that differ between two audit snapshots of a line, in plain words. */
export function describeLineChanges(before: Json, after: Json): LineChange[] {
  const changes: LineChange[] = [];
  for (const { key, label, format } of FIELDS) {
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    changes.push({ field: key, label, from: format(a), to: format(b) });
  }
  return changes;
}
