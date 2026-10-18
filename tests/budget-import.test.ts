import { describe, expect, it } from "vitest";
import { findHeaderRow, mapHeaders, parseBudgetSheet, parseMoney, parseSheetDate } from "@/lib/budget/import";

const options = { fiscalYear: "2025-26", unboughtAs: "CANCELLED" as const };

describe("budget sheet import", () => {
  it("reads money the way spreadsheets write it", () => {
    expect(parseMoney("$1,299.50")).toBe(129_950);
    expect(parseMoney("(50.00)")).toBe(-5_000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });

  it("places month-only dates inside the fiscal year", () => {
    expect(parseSheetDate("Jun 2025", "2025-26")).toEqual({ date: "2025-06-01", guessed: true });
    expect(parseSheetDate("May 28", "2025-26")).toEqual({ date: "2026-05-28", guessed: true });
    expect(parseSheetDate("Oct", "2025-26")).toEqual({ date: "2025-10-01", guessed: true });
    expect(parseSheetDate("5/28/2026", "2025-26")).toEqual({ date: "2026-05-28", guessed: false });
    expect(parseSheetDate("2026-05-28", "2025-26")).toEqual({ date: "2026-05-28", guessed: false });
    expect(parseSheetDate("soon", "2025-26")).toBeNull();
  });

  it("maps headers by name in any order, keeping Order date apart from Order number", () => {
    expect(mapHeaders(["Item", "Order Date", "Order #", "Budgeted", "Actual", "PO"])).toEqual({
      description: 0,
      date: 1,
      order: 2,
      budgeted: 3,
      spent: 4,
      po: 5,
    });
  });

  it("finds the header under a title block", () => {
    expect(findHeaderRow([["FY25 budget"], [""], ["Item", "Qty", "Budgeted", "Spent"], ["Camera", "1", "100", "90"]])).toBe(2);
    expect(findHeaderRow([["nothing", "useful"]])).toBe(-1);
  });

  it("turns rows into ready, check, and skipped lines", () => {
    const { candidates, problem } = parseBudgetSheet(
      [
        ["Item", "Category", "Qty", "Each", "Budgeted", "Spent", "Month", "PO"],
        ["Sony FX3", "Equipment", "2", "", "$7,995", "$8,000", "May 28", "PO-1"],
        ["Misc supplies", "", "", "", "", "$212", "Jun", ""],
        ["Tripod", "", "1", "", "$1,800", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["Total", "", "", "", "$14,950", "$13,203", "", ""],
      ],
      options,
    );
    expect(problem).toBeNull();
    expect(candidates.map((c) => [c.description, c.result, c.status, c.unplanned])).toEqual([
      ["Sony FX3", "ready", "PURCHASED", false],
      ["Misc supplies", "check", "PURCHASED", true],
      ["Tripod", "check", "CANCELLED", false],
      ["Total", "skipped", "PLANNED", false],
    ]);
    const fx3 = candidates[0]!;
    expect(fx3).toMatchObject({ quantity: 2, budgetedCents: 799_500, unitCostCents: 399_750, spentCents: 800_000, purchasedOn: "2026-05-28", poNumber: "PO-1", row: 2 });
    expect(candidates[1]).toMatchObject({ budgetedCents: null, spentCents: 21_200, purchasedOn: "2026-06-01" });
  });

  it("keeps unbought lines planned when asked", () => {
    const { candidates } = parseBudgetSheet([["Item", "Budgeted"], ["Lens", "$2,199"]], { fiscalYear: "2026-27", unboughtAs: "PLANNED" });
    expect(candidates[0]).toMatchObject({ result: "ready", status: "PLANNED" });
  });

  it("explains a sheet it can't read", () => {
    expect(parseBudgetSheet([["a", "b"]], options).problem).toMatch(/header row/);
  });
});
