import { BUDGET_CATEGORY_LABELS, plannedCents, type BudgetCategoryValue, type BudgetLineStatusValue } from "@/lib/budget/contract";

/** The slice of a line the table filters and sorts on. */
export type TableLine = {
  description: string;
  supplier: string | null;
  poNumber: string | null;
  orderNumber: string | null;
  category: BudgetCategoryValue;
  status: BudgetLineStatusValue;
  statusKnown?: boolean;
  unitCostCents: number;
  plannedTotalKnown?: boolean;
  plannedOverrideCents?: number | null;
  quantity: number;
  spentCents: number | null;
  purchasedOn: string | null;
};

export const LINE_SORTS = ["entered", "amount", "date", "name"] as const;
export type LineSort = (typeof LINE_SORTS)[number];
export const LINE_SORT_LABELS: Record<LineSort, string> = {
  entered: "As entered",
  amount: "Biggest first",
  date: "Newest first",
  name: "A to Z",
};

/** What a line really costs: the recorded spend when bought, else the plan. */
export const lineAmountCents = (line: Pick<TableLine, "unitCostCents" | "quantity" | "spentCents" | "plannedTotalKnown" | "plannedOverrideCents">): number =>
  line.spentCents ?? plannedCents(line);

/** Search matches description, supplier, PO, order number, and category name; every word must match. */
export function matchesQuery(line: TableLine, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [line.description, line.supplier, line.poNumber, line.orderNumber, BUDGET_CATEGORY_LABELS[line.category]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterAndSortLines<T extends TableLine>(
  lines: readonly T[],
  options: { query: string; status: BudgetLineStatusValue | "ALL" | "UNKNOWN"; sort: LineSort },
): T[] {
  const kept = lines.filter(
    (line) => (options.status === "ALL" || (options.status === "UNKNOWN" ? line.statusKnown === false : line.statusKnown !== false && line.status === options.status)) && matchesQuery(line, options.query),
  );
  if (options.sort === "entered") return kept;
  const sorted = [...kept];
  if (options.sort === "amount") sorted.sort((a, b) => lineAmountCents(b) - lineAmountCents(a));
  else if (options.sort === "name") sorted.sort((a, b) => a.description.localeCompare(b.description));
  else {
    // Undated lines (planned) sink to the bottom.
    sorted.sort((a, b) => (b.purchasedOn ?? "").localeCompare(a.purchasedOn ?? ""));
  }
  return sorted;
}
