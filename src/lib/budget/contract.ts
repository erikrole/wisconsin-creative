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
  CANCELLED: "Dropped",
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
  unitCostKnown?: boolean;
  plannedTotalKnown?: boolean;
  plannedOverrideCents?: number | null;
  statusKnown?: boolean;
  submittedIncluded?: boolean;
  submittedAmountCents?: number | null;
  spentCents: number | null;
  /** Added after the plan was submitted; it has no place in the submitted plan. */
  unplanned?: boolean;
  /** Refund or credit received; the real cost is spent minus this. */
  refundCents?: number | null;
};

/** What the line really cost after any refund or credit; null while nothing is spent. */
export function netSpentCents(line: Pick<BudgetLineMoney, "spentCents" | "refundCents">): number | null {
  if (line.spentCents === null) return null;
  return Math.max(0, line.spentCents - (line.refundCents ?? 0));
}

/** What the line was planned to cost. */
export function plannedCents(line: Pick<BudgetLineMoney, "unitCostCents" | "quantity" | "plannedTotalKnown" | "plannedOverrideCents">): number {
  if (line.plannedTotalKnown === false) return 0;
  return line.plannedOverrideCents ?? line.unitCostCents * line.quantity;
}

type BudgetCategoryTotal = {
  category: BudgetCategoryValue;
  plannedCents: number;
  spentCents: number;
};

export type BudgetSummary = {
  /** Planned total of every line that is not dropped. */
  plannedCents: number;
  /** The plan as submitted: every line that was on it, dropped ones included. Never moves. */
  submittedCents: number;
  /** Money returned to the budget by dropped lines. */
  freedCents: number;
  /** What lines added after the plan was submitted cost (spent, or estimated until bought). */
  unplannedCents: number;
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
  unknownSpentCount: number;
  unknownPlannedCount: number;
  unknownStatusCount: number;
  statusSpendConflictCount: number;
  submittedUnknownCount: number;
  counts: Record<BudgetLineStatusValue, number>;
  byCategory: BudgetCategoryTotal[];
};

export function summarizeBudget(
  lines: BudgetLineMoney[],
  allocationCents: number | null,
  snapshot?: { submittedCents: number | null; submittedUnknownCount: number },
): BudgetSummary {
  const counts: Record<BudgetLineStatusValue, number> = { PLANNED: 0, ORDERED: 0, PURCHASED: 0, CANCELLED: 0 };
  const categories = new Map<BudgetCategoryValue, BudgetCategoryTotal>();
  let planned = 0;
  let submitted = 0;
  let freed = 0;
  let unplannedTotal = 0;
  let spent = 0;
  let outstanding = 0;
  let unknownSpentCount = 0;
  let unknownPlannedCount = 0;
  let unknownStatusCount = 0;
  let statusSpendConflictCount = 0;

  for (const line of lines) {
    counts[line.status] += 1;
    if (line.statusKnown === false) unknownStatusCount += 1;
    if ((line.status === "PLANNED" || line.status === "CANCELLED") && (line.spentCents ?? 0) > 0) statusSpendConflictCount += 1;
    if (!line.unplanned) submitted += plannedCents(line);
    if (line.status === "CANCELLED") {
      if (line.submittedIncluded) freed += line.submittedAmountCents ?? 0;
      else if (snapshot?.submittedCents == null && !line.unplanned) freed += plannedCents(line);
      continue;
    }
    if (line.status === "PURCHASED" && line.spentCents === null) unknownSpentCount += 1;
    if (line.plannedTotalKnown === false) unknownPlannedCount += 1;
    const outsideSavedPlan = snapshot?.submittedCents != null ? !line.submittedIncluded : !!line.unplanned;
    if (outsideSavedPlan) unplannedTotal += netSpentCents(line) ?? plannedCents(line);
    const linePlanned = plannedCents(line);
    const lineSpent = netSpentCents(line) ?? 0;
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
    submittedCents: snapshot?.submittedCents ?? submitted,
    freedCents: freed,
    unplannedCents: unplannedTotal,
    spentCents: spent,
    outstandingCents: outstanding,
    forecastCents: forecast,
    allocationCents,
    remainingCents: (allocationCents ?? planned) - forecast,
    unknownSpentCount,
    unknownPlannedCount,
    unknownStatusCount,
    statusSpendConflictCount,
    submittedUnknownCount: snapshot?.submittedCents == null
      ? lines.filter((line) => !line.unplanned && line.plannedTotalKnown === false).length
      : snapshot.submittedUnknownCount,
    counts,
    byCategory: [...categories.values()].sort((a, b) => b.plannedCents - a.plannedCents),
  };
}

/**
 * How a line landed against the submitted plan, in cents (positive is over). Null while it is
 * still planned. Dropped lines free their whole plan; unplanned lines are entirely over.
 */
export function varianceCents(line: BudgetLineMoney, hasSavedPlan = false): number | null {
  const baseline = line.submittedIncluded ? line.submittedAmountCents : hasSavedPlan || line.unplanned ? 0 : line.plannedTotalKnown === false ? null : plannedCents(line);
  if (baseline == null) return null;
  if (line.status === "CANCELLED") return -baseline;
  const net = netSpentCents(line);
  if (net === null) return null;
  return net - baseline;
}

/** "2026-27" style labels only; keeps the unique (name, year) key tidy. */
export const FISCAL_YEAR_PATTERN = /^\d{4}-\d{2}$/;

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole dollars when the amount is exact, otherwise with cents: "$7,995" or "$1,299.50". */
export function formatCentsCompact(cents: number): string {
  return cents % 100 === 0 ? formatCents(cents).replace(/\.00$/, "") : formatCents(cents);
}

/** "1,299.50", "$1299" -> whole cents; null when empty or not a money amount. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** UW-Madison's fiscal year runs July 1 to June 30; "2025-26" is Jul 2025 to Jun 2026. */
export function fiscalYearLabel(fiscalYear: string): string {
  if (!FISCAL_YEAR_PATTERN.test(fiscalYear)) return fiscalYear;
  const start = Number(fiscalYear.slice(0, 4));
  return `FY${String(start + 1).slice(-2)} · Jul ${start} – Jun ${start + 1}`;
}

/** The stored label for the fiscal year a date falls in: July onward starts the next one. */
export function fiscalYearOf(date: Date): string {
  const start = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
