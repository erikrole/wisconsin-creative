import type { BudgetCategoryValue, BudgetLineStatusValue, BudgetSummary } from "@/lib/budget/contract";

export type BudgetListItem = { id: string; name: string; fiscalYear: string; allocationCents: number | null; lineCount: number };
export type LineView = {
  id: string;
  category: BudgetCategoryValue;
  status: BudgetLineStatusValue;
  description: string;
  supplier: string | null;
  unitCostCents: number;
  quantity: number;
  quantityBought: number | null;
  spentCents: number | null;
  purchasedOn: string | null;
  orderNumber: string | null;
  poNumber: string | null;
  linkUrl: string | null;
  justification: string | null;
  requesterUserId: string | null;
  requesterName: string | null;
  requesterNote: string | null;
  unplanned: boolean;
  refundCents: number | null;
  recurring: boolean;
  gearPickCycleId: string | null;
  links: LinkView[];
};
export type LinkView = {
  id: string;
  quantity: number;
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
};
export type Suggestion = {
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
  suggestedQuantity: number;
  score: number;
  confidence: "high" | "likely" | "possible";
  reasons: string[];
};
export type SearchResult = { kind: "asset" | "bulk"; targetId: string; label: string; imageUrl: string | null; detail: string | null };
export type Detail = {
  budget: { id: string; name: string; fiscalYear: string; allocationCents: number | null; notes: string | null };
  lines: LineView[];
  summary: BudgetSummary;
  /** Under Armour allotment years a line can top up. */
  uaCycles: { id: string; title: string }[];
};
