import { describe, expect, it } from "vitest";
import { fiscalYearLabel, fiscalYearOf, formatCents, parseDollarsToCents, plannedCents, summarizeBudget, varianceCents, type BudgetLineMoney } from "@/lib/budget/contract";

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

describe("plan changes", () => {
  const lines = [
    line({ status: "PURCHASED", unitCostCents: 400_00, spentCents: 410_00 }),
    line({ status: "CANCELLED", unitCostCents: 180_00 }),
    line({ status: "PURCHASED", unitCostCents: 0, spentCents: 64_00, unplanned: true }),
    line({ unitCostCents: 220_00 }),
  ];

  it("keeps the submitted plan fixed, with dropped lines in it and unplanned lines out", () => {
    const summary = summarizeBudget(lines, null);
    expect(summary.submittedCents).toBe(800_00);
    expect(summary.freedCents).toBe(180_00);
    expect(summary.unplannedCents).toBe(64_00);
    expect(summary.forecastCents).toBe(410_00 + 64_00 + 220_00);
  });

  it("measures each line against the plan", () => {
    expect(varianceCents(lines[0]!)).toBe(10_00);
    expect(varianceCents(lines[1]!)).toBe(-180_00);
    expect(varianceCents(lines[2]!)).toBe(64_00);
    expect(varianceCents(lines[3]!)).toBeNull();
  });
});

describe("fiscal years", () => {
  it("labels the July 1 fiscal year", () => {
    expect(fiscalYearLabel("2025-26")).toBe("FY26 · Jul 2025 – Jun 2026");
    expect(fiscalYearLabel("nonsense")).toBe("nonsense");
  });

  it("finds the fiscal year a date falls in", () => {
    expect(fiscalYearOf(new Date("2026-06-30T12:00:00Z"))).toBe("2025-26");
    expect(fiscalYearOf(new Date("2026-07-01T00:00:00Z"))).toBe("2026-27");
  });
});
