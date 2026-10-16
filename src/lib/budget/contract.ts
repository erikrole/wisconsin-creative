/**
 * Budget rules shared by the service, the routes, and the page. Money is whole cents;
 * the budgeted total of a line is unit cost x quantity and is never stored.
 * Reference: docs/AREA_BUDGET.md
 */

export const BUDGET_LINE_STATUSES = ["PLANNED", "ORDERED", "PURCHASED", "CANCELLED"] as const;
export type BudgetLineStatusValue = (typeof BUDGET_LINE_STATUSES)[number];

export const BUDGET_CATEGORIES = [
  "AWARDS_PRIZES",
  "BUSINESS_TRAVEL",
  "EQUIPMENT",
  "IT_SERVICES",
  "LEASES",
  "MAINTENANCE_REPAIRS",
  "MATERIALS_SUPPLIES",
  "RENTALS",
  "SERVICES",
  "SUBSCRIPTIONS_DUES",
  "TELECOMMUNICATIONS",
] as const;
export type BudgetCategoryValue = (typeof BUDGET_CATEGORIES)[number];

export const BUDGET_STATUS_LABELS: Record<BudgetLineStatusValue, string> = {
  PLANNED: "Planned",
  ORDERED: "Ordered",
  PURCHASED: "Purchased",
  CANCELLED: "Cancelled",
};

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategoryValue, string> = {
  AWARDS_PRIZES: "Awards & Prizes",
  BUSINESS_TRAVEL: "Business Travel",
  EQUIPMENT: "Equipment Expense",
  IT_SERVICES: "IT & Services",
  LEASES: "Leases",
  MAINTENANCE_REPAIRS: "Maintenance & Repairs",
  MATERIALS_SUPPLIES: "Materials & Supplies",
  RENTALS: "Rentals",
  SERVICES: "Services",
  SUBSCRIPTIONS_DUES: "Subscriptions & Dues",
  TELECOMMUNICATIONS: "Telecommunications",
};

/** Largest single money value accepted: $10,000,000 in cents. Stops a typo from corrupting totals. */
export const MAX_BUDGET_CENTS = 1_000_000_000;

export type BudgetLineMoney = {
  status: BudgetLineStatusValue;
  category: BudgetCategoryValue;
  unitCostCents: number;
  quantity: number;
  spentCents: number | null;
};

/** What the line was planned to cost. */
export function plannedCents(line: Pick<BudgetLineMoney, "unitCostCents" | "quantity">): number {
  return line.unitCostCents * line.quantity;
}

export type BudgetCategoryTotal = {
  category: BudgetCategoryValue;
  plannedCents: number;
  spentCents: number;
};

export type BudgetSummary = {
  /** Planned total of every line that is not cancelled. */
  plannedCents: number;
  /** Money actually spent so far. */
  spentCents: number;
  /** Planned money for lines not bought yet (planned or ordered with no spend recorded). */
  outstandingCents: number;
  /** Spent plus outstanding: where the year is heading. */
  forecastCents: number;
  /** The overall cap, or null when the allocation isn't known. */
  allocationCents: number | null;
  /** Cap (or, without one, the planned total) minus the forecast. Negative means over. */
  remainingCents: number;
  counts: Record<BudgetLineStatusValue, number>;
  byCategory: BudgetCategoryTotal[];
};

export function summarizeBudget(lines: BudgetLineMoney[], allocationCents: number | null): BudgetSummary {
  const counts: Record<BudgetLineStatusValue, number> = { PLANNED: 0, ORDERED: 0, PURCHASED: 0, CANCELLED: 0 };
  const categories = new Map<BudgetCategoryValue, BudgetCategoryTotal>();
  let planned = 0;
  let spent = 0;
  let outstanding = 0;

  for (const line of lines) {
    counts[line.status] += 1;
    if (line.status === "CANCELLED") continue;
    const linePlanned = plannedCents(line);
    const lineSpent = line.spentCents ?? 0;
    planned += linePlanned;
    spent += lineSpent;
    if (line.status !== "PURCHASED" && line.spentCents === null) outstanding += linePlanned;

    const total = categories.get(line.category) ?? { category: line.category, plannedCents: 0, spentCents: 0 };
    total.plannedCents += linePlanned;
    total.spentCents += lineSpent;
    categories.set(line.category, total);
  }

  const forecast = spent + outstanding;
  return {
    plannedCents: planned,
    spentCents: spent,
    outstandingCents: outstanding,
    forecastCents: forecast,
    allocationCents,
    remainingCents: (allocationCents ?? planned) - forecast,
    counts,
    byCategory: [...categories.values()].sort((a, b) => b.plannedCents - a.plannedCents),
  };
}

/** "2026-27" style labels only; keeps the unique (name, year) key tidy. */
export const FISCAL_YEAR_PATTERN = /^\d{4}-\d{2}$/;

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1,299.50", "$1299" -> whole cents; null when empty or not a money amount. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
