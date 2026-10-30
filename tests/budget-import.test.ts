import { describe, expect, it } from "vitest";
import { findHeaderRow, mapHeaders, parseBudgetSheet, parseMoney, parseSheetDate, suggestSheet } from "@/lib/budget/import";

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
      ["Sony FX3", "check", "PURCHASED", false],
      ["Misc supplies", "check", "PURCHASED", false],
      ["Tripod", "check", "CANCELLED", false],
      ["Total", "skipped", "PLANNED", false],
    ]);
    const fx3 = candidates[0]!;
    expect(fx3).toMatchObject({ quantity: 2, budgetedCents: 799_500, unitCostCents: 0, unitCostKnown: false, spentCents: 800_000, purchasedOn: null, poNumber: "PO-1", row: 2 });
    expect(candidates[1]).toMatchObject({ budgetedCents: null, spentCents: 21_200, purchasedOn: null });
  });

  it("keeps unbought lines planned when asked", () => {
    const { candidates } = parseBudgetSheet([["Item", "Budgeted"], ["Lens", "$2,199"]], { fiscalYear: "2026-27", unboughtAs: "PLANNED" });
    expect(candidates[0]).toMatchObject({ result: "check", status: "PLANNED", statusKnown: false });
  });

  it("explains a sheet it can't read", () => {
    expect(parseBudgetSheet([["a", "b"]], options).problem).toMatch(/header row/);
  });

  describe("the department's own workbook", () => {
    const HEADER = ["Category", "Status", "Description", "Supplier Name/ID", "Price Per Unit", "Quantity", "Total Budgeted", "Quantity Bought", "Total Spent", "Month Purchased", "Link", "Notes", "Person/Persons Requesting"];
    const workbookOptions = { fiscalYear: "2026-27", unboughtAs: "PLANNED" as const, today: "2026-10-18" };

    it("matches the real column names", () => {
      expect(mapHeaders(HEADER)).toMatchObject({ category: 0, status: 1, description: 2, supplier: 3, each: 4, quantity: 5, budgeted: 6, boughtQuantity: 7, spent: 8, date: 9 });
    });

    it("reads the Status column and keeps what the sheet already decided", () => {
      const { candidates } = parseBudgetSheet(
        [
          HEADER,
          ["Equipment Expense", "Purchased", "Sony FX3 Body", "B&H Photo", "3997.64", "2", "7995.28", "2", "7995.28", "MAY"],
          ["Telecommunications", "Planned", "Cellphone Lines", "Campus/Verizon", "1200", "7", "8400", "", "", ""],
          ["Materials & Supplies", "Cancelled", "SanDisk 256GB SD Card", "B&H Photo", "259.99", "10", "2599.9", "", "", ""],
          ["Equipment Expense", "Ordered", "Dell Monitor", "Dell", "1139", "1", "1139", "", "", ""],
        ],
        workbookOptions,
      );
      expect(candidates.map((c) => [c.description, c.status, c.result])).toEqual([
        ["Sony FX3 Body", "PURCHASED", "check"],
        ["Cellphone Lines", "PLANNED", "ready"],
        ["SanDisk 256GB SD Card", "CANCELLED", "ready"],
        ["Dell Monitor", "ORDERED", "ready"],
      ]);
      // MAY on the 26-27 tab is May 2026, not a purchase date in the future.
      expect(candidates[0]).toMatchObject({ supplier: "B&H Photo", spentCents: 799_528, budgetedCents: 799_528, purchasedOn: null });
    });

    it("treats a bought row with no budget as a late addition at the quantity bought", () => {
      const { candidates } = parseBudgetSheet(
        [
          HEADER,
          ["Materials & Supplies", "Purchased", "Audio Technica AT875R", "B&H Photo", "141.75", "", "", "2", "283.5", "JULY"],
          ["Materials & Supplies", "Purchased", "Sony 128GB SD Card", "B&H Photo", "116.35", "10", "0", "10", "1163.5", "MAY"],
        ],
        workbookOptions,
      );
      expect(candidates[0]).toMatchObject({ unplanned: false, budgetedCents: null, quantity: 1, quantityBought: 2, unitCostCents: 14_175, spentCents: 28_350, result: "check", purchasedOn: null });
      expect(candidates[1]).toMatchObject({ unplanned: true, budgetedCents: 0, quantity: 10, spentCents: 116_350 });
    });

    it("keeps a placeholder budget total unknown even when price and quantity are present", () => {
      const { candidates } = parseBudgetSheet(
        [["Item", "Price", "Quantity", "Total Budgeted", "Total Spent"], ["Sony a7V", "2563.53", "1", "X", "2563.53"]],
        workbookOptions,
      );
      expect(candidates[0]).toMatchObject({ unplanned: false, budgetedCents: null, spentCents: 256_353, status: "PURCHASED" });
    });

    it("stops at the category summary table under the purchases", () => {
      const { candidates } = parseBudgetSheet(
        [
          HEADER,
          ["Awards & Prizes", "Planned", "SVG Awards Entries", "SVG", "100", "5", "500"],
          ["", "", "", "", "", "", ""],
          ["", "", "", "", "", "", ""],
          ["Category", "Column 1", "Budgeted", "Purchased", "Remaining", "Spent vs Budget"],
          ["Awards & Prizes", "", "500", "", "500", ""],
        ],
        workbookOptions,
      );
      expect(candidates.map((c) => c.description)).toEqual(["SVG Awards Entries"]);
    });

    it("counts older years as bought when asked, and honors the checkbox column", () => {
      const rows = [["P", "Item", "Price", "Quantity", "Total"], ["true", "Sony a1 II", "6188", "1", "6188"], ["false", "Spare grip", "100", "1", "100"]];
      const asBought = parseBudgetSheet([["Item", "Price", "Quantity", "Total"], ["Mic", "2495", "1", "2495"]], { ...workbookOptions, fiscalYear: "2022-23", unboughtAs: "PURCHASED" });
      expect(asBought.candidates[0]).toMatchObject({ status: "PURCHASED", spentCents: null, budgetedCents: 249_500 });
      const flagged = parseBudgetSheet(rows, { ...workbookOptions, fiscalYear: "2025-26", unboughtAs: "CANCELLED" });
      expect(flagged.candidates.map((c) => [c.status, c.spentCents])).toEqual([["PURCHASED", null], ["CANCELLED", null]]);
      // A checked box records purchase status, not an actual-spend amount.
      expect(flagged.candidates[0]).toMatchObject({ result: "check", note: "Marked bought; actual spend not recorded." });
    });

    it("suggests the tab for the budget's year and for Football", () => {
      const tabs = ["27-28", "26-27", "FB 26-27", "25-26", "FB25-26", "FB:23-24", "Expense Category"].map((name) => ({ name, usable: name !== "27-28" && name !== "Expense Category" }));
      expect(suggestSheet(tabs, "Creative", "2026-27")).toBe("26-27");
      expect(suggestSheet(tabs, "Football", "2026-27")).toBe("FB 26-27");
      expect(suggestSheet(tabs, "Football", "2025-26")).toBe("FB25-26");
      expect(suggestSheet(tabs, "Football", "2023-24")).toBe("FB:23-24");
      expect(suggestSheet([{ name: "x", usable: false }], "Creative", "2026-27")).toBeNull();
    });
  });
});
