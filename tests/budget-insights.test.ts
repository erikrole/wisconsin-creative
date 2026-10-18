import { describe, expect, it } from "vitest";
import { linesToCsv, monthlySpend, overPlanLines, supplierTotals, type InsightLine } from "@/lib/budget/insights";

const line = (overrides: Partial<InsightLine>): InsightLine => ({
  description: "Thing",
  category: "EQUIPMENT",
  status: "PURCHASED",
  supplier: "B&H Photo",
  unitCostCents: 100_00,
  quantity: 1,
  spentCents: 100_00,
  refundCents: null,
  purchasedOn: "2026-05-28",
  poNumber: null,
  orderNumber: null,
  unplanned: false,
  ...overrides,
});

describe("budget insights", () => {
  it("buckets spend by month in fiscal order, net of refunds", () => {
    const { months, undatedCents } = monthlySpend([
      line({ purchasedOn: "2025-07-02", spentCents: 50_00 }),
      line({ purchasedOn: "2026-06-30", spentCents: 200_00, refundCents: 20_00 }),
      line({ purchasedOn: "2026-01-15", spentCents: 10_00 }),
      line({ purchasedOn: null, spentCents: 5_00 }),
      line({ status: "CANCELLED", purchasedOn: "2026-02-01", spentCents: 99_00 }),
    ]);
    expect(months[0]).toEqual({ label: "Jul", spentCents: 50_00 });
    expect(months[6]).toEqual({ label: "Jan", spentCents: 10_00 });
    expect(months[11]).toEqual({ label: "Jun", spentCents: 180_00 });
    expect(undatedCents).toBe(5_00);
  });

  it("ranks suppliers by what was spent", () => {
    const totals = supplierTotals([
      line({ supplier: "Dell", spentCents: 129_600 }),
      line({ supplier: "B&H Photo", spentCents: 80_000 }),
      line({ supplier: "B&H Photo", spentCents: 84_000 }),
      line({ supplier: null, spentCents: 1_000 }),
      line({ supplier: "Amazon", spentCents: null }),
    ]);
    expect(totals.map((t) => [t.supplier, t.spentCents, t.orders])).toEqual([
      ["B&H Photo", 164_000, 2],
      ["Dell", 129_600, 1],
      ["No supplier", 1_000, 1],
    ]);
  });

  it("finds lines over plan but not unplanned or dropped ones", () => {
    const over = overPlanLines([
      line({ description: "Over", spentCents: 120_00 }),
      line({ description: "Under", spentCents: 80_00 }),
      line({ description: "Unplanned", unplanned: true, unitCostCents: 0, spentCents: 640_00 }),
      line({ description: "Dropped", status: "CANCELLED", spentCents: null }),
    ]);
    expect(over.map((l) => l.description)).toEqual(["Over"]);
  });

  it("exports a spreadsheet-safe CSV", () => {
    const csv = linesToCsv([line({ description: '=HYPERLINK("x")', supplier: "B&H, Inc", unplanned: true, unitCostCents: 0 })]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Budgeted");
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain('"B&H, Inc"');
    expect(row?.endsWith("Yes")).toBe(true);
  });
});
