import { describe, expect, it } from "vitest";
import { filterAndSortLines, lineAmountCents, matchesQuery, type TableLine } from "@/lib/budget/table";

const line = (overrides: Partial<TableLine>): TableLine => ({
  description: "Sony FX3",
  supplier: "B&H Photo",
  poNumber: "PO-00177267",
  orderNumber: "1129416779",
  category: "EQUIPMENT",
  status: "PURCHASED",
  unitCostCents: 400_000,
  quantity: 2,
  spentCents: 800_000,
  purchasedOn: "2026-05-28",
  ...overrides,
});

describe("budget table", () => {
  it("uses spend when known, else plan", () => {
    expect(lineAmountCents(line({}))).toBe(800_000);
    expect(lineAmountCents(line({ spentCents: null }))).toBe(800_000);
    expect(lineAmountCents(line({ spentCents: null, quantity: 1 }))).toBe(400_000);
  });

  it("searches description, supplier, PO, and order number with every word required", () => {
    expect(matchesQuery(line({}), "fx3")).toBe(true);
    expect(matchesQuery(line({}), "b&h 177267")).toBe(true);
    expect(matchesQuery(line({}), "1129416779")).toBe(true);
    expect(matchesQuery(line({}), "fx3 dell")).toBe(false);
    expect(matchesQuery(line({}), "   ")).toBe(true);
  });

  it("filters by status and sorts without mutating the input", () => {
    const lines = [
      line({ description: "Dell laptop", spentCents: 129_593, purchasedOn: "2026-06-10" }),
      line({ description: "Sony FX3", purchasedOn: "2026-05-28" }),
      line({ description: "24-70mm", status: "PLANNED", spentCents: null, unitCostCents: 219_900, quantity: 1, purchasedOn: null }),
    ];
    const snapshot = lines.map((entry) => entry.description);
    expect(filterAndSortLines(lines, { query: "", status: "ALL", sort: "amount" }).map((l) => l.description)).toEqual([
      "Sony FX3",
      "24-70mm",
      "Dell laptop",
    ]);
    expect(filterAndSortLines(lines, { query: "", status: "ALL", sort: "date" }).map((l) => l.description)).toEqual([
      "Dell laptop",
      "Sony FX3",
      "24-70mm",
    ]);
    expect(filterAndSortLines(lines, { query: "", status: "PLANNED", sort: "name" })).toHaveLength(1);
    expect(lines.map((entry) => entry.description)).toEqual(snapshot);
  });
});
