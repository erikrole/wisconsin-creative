import {
  BUDGET_CATEGORY_LABELS,
  netSpentCents,
  plannedCents,
  type BudgetCategoryValue,
  type BudgetLineStatusValue,
} from "@/lib/budget/contract";
import { csvField } from "@/lib/csv";

export type InsightLine = {
  description: string;
  category: BudgetCategoryValue;
  status: BudgetLineStatusValue;
  supplier: string | null;
  unitCostCents: number;
  quantity: number;
  spentCents: number | null;
  refundCents: number | null;
  purchasedOn: string | null;
  poNumber: string | null;
  orderNumber: string | null;
  unplanned: boolean;
};

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"] as const;

export type MonthBucket = { label: (typeof MONTHS)[number]; spentCents: number };

/** Spend by month in fiscal order (Jul first). Lines without an order date are left out and counted separately. */
export function monthlySpend(lines: InsightLine[]): { months: MonthBucket[]; undatedCents: number } {
  const months: MonthBucket[] = MONTHS.map((label) => ({ label, spentCents: 0 }));
  let undated = 0;
  for (const line of lines) {
    const net = netSpentCents(line);
    if (net === null || line.status === "CANCELLED") continue;
    if (!line.purchasedOn) {
      undated += net;
      continue;
    }
    const month = Number(line.purchasedOn.slice(5, 7)) - 1;
    const slot = (month + 6) % 12; // July (index 6) becomes slot 0
    months[slot]!.spentCents += net;
  }
  return { months, undatedCents: undated };
}

export type SupplierTotal = { supplier: string; spentCents: number; orders: number };

/** Who the money went to, biggest first. */
export function supplierTotals(lines: InsightLine[]): SupplierTotal[] {
  const totals = new Map<string, SupplierTotal>();
  for (const line of lines) {
    const net = netSpentCents(line);
    if (net === null || line.status === "CANCELLED") continue;
    const key = line.supplier?.trim() || "No supplier";
    const entry = totals.get(key) ?? { supplier: key, spentCents: 0, orders: 0 };
    entry.spentCents += net;
    entry.orders += 1;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.spentCents - a.spentCents);
}

/** Lines that cost more than planned (not counting unplanned ones, which are over by definition). */
export function overPlanLines(lines: InsightLine[]): InsightLine[] {
  return lines.filter((line) => {
    if (line.unplanned || line.status === "CANCELLED") return false;
    const net = netSpentCents(line);
    return net !== null && net > plannedCents(line);
  });
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/** The lines table as CSV for a spreadsheet. */
export function linesToCsv(lines: InsightLine[]): string {
  const header = ["Line", "Category", "Status", "Supplier", "Qty", "Each", "Budgeted", "Spent", "Refund", "Ordered", "PO", "Order number", "Unplanned"];
  const rows = lines.map((line) => [
    line.description,
    BUDGET_CATEGORY_LABELS[line.category],
    line.status === "CANCELLED" ? "Dropped" : line.status[0] + line.status.slice(1).toLowerCase(),
    line.supplier,
    line.quantity,
    line.unplanned ? "" : dollars(line.unitCostCents),
    line.unplanned ? "" : dollars(plannedCents(line)),
    dollars(line.spentCents),
    dollars(line.refundCents),
    line.purchasedOn,
    line.poNumber,
    line.orderNumber,
    line.unplanned ? "Yes" : "",
  ]);
  return [header, ...rows].map((row) => row.map((value) => csvField(value as string | number | null)).join(",")).join("\r\n");
}
