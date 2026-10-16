import { describe, expect, it } from "vitest";
import { formatCents, parseDollarsToCents, plannedCents, summarizeBudget, type BudgetLineMoney } from "@/lib/budget/contract";

const line = (overrides: Partial<BudgetLineMoney>): BudgetLineMoney => ({
  status: "PLANNED",
  category: "EQUIPMENT",
  unitCostCents: 100_00,
  quantity: 1,
  spentCents: null,
  ...overrides,
});

describe("budget summary", () => {
  it("plans unit cost times quantity", () => {
    expect(plannedCents({ unitCostCents: 66_00, quantity: 20 })).toBe(1_320_00);
  });

  it("skips cancelled lines and counts every status", () => {
    const summary = summarizeBudget(
      [
        line({ unitCostCents: 500_00 }),
        line({ status: "CANCELLED", unitCostCents: 900_00 }),
        line({ status: "PURCHASED", unitCostCents: 200_00, spentCents: 250_00 }),
      ],
      null,
    );
    expect(summary.plannedCents).toBe(700_00);
    expect(summary.spentCents).toBe(250_00);
    expect(summary.outstandingCents).toBe(500_00);
    expect(summary.forecastCents).toBe(750_00);
    expect(summary.counts).toEqual({ PLANNED: 1, ORDERED: 0, PURCHASED: 1, CANCELLED: 1 });
  });

  it("measures remaining against the allocation, or the plan when there is no cap", () => {
    const lines = [line({ unitCostCents: 400_00 }), line({ status: "PURCHASED", unitCostCents: 300_00, spentCents: 300_00 })];
    expect(summarizeBudget(lines, 1_000_00).remainingCents).toBe(300_00);
    expect(summarizeBudget(lines, null).remainingCents).toBe(0);
    expect(summarizeBudget(lines, 600_00).remainingCents).toBe(-100_00);
  });

  it("treats an ordered line with spend recorded as no longer outstanding", () => {
    const summary = summarizeBudget([line({ status: "ORDERED", unitCostCents: 300_00, spentCents: 280_00 })], null);
    expect(summary.outstandingCents).toBe(0);
    expect(summary.forecastCents).toBe(280_00);
  });

  it("sorts categories by planned total", () => {
    const summary = summarizeBudget(
      [line({ category: "RENTALS", unitCostCents: 10_00 }), line({ category: "EQUIPMENT", unitCostCents: 50_00 })],
      null,
    );
    expect(summary.byCategory.map((row) => row.category)).toEqual(["EQUIPMENT", "RENTALS"]);
  });
});

describe("money helpers", () => {
  it("parses dollars to cents", () => {
    expect(parseDollarsToCents("$1,299.50")).toBe(129_950);
    expect(parseDollarsToCents("66")).toBe(6_600);
    expect(parseDollarsToCents("12.5")).toBe(1_250);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
  });

  it("formats cents", () => {
    expect(formatCents(129_950)).toBe("$1,299.50");
    expect(formatCents(-5_000)).toBe("-$50.00");
  });
});
