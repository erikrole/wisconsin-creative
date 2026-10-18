import { describe, expect, it } from "vitest";
import { scoreLineItemMatch, tokens, type MatchItem, type MatchLine } from "@/lib/budget/matching";

const line: MatchLine = {
  description: "Sony FE 24-70mm f/2.8 GM II Lens",
  supplier: "B&H Photo",
  unitCostCents: 195_684,
  purchasedOn: "2026-05-14",
  poNumber: "PO-00177267",
  orderNumber: "1129416779",
};

const lens: MatchItem = {
  name: null,
  brand: "Sony",
  model: "FE 24-70mm f/2.8 GM II",
  purchasePriceCents: 195_684,
  purchaseDate: "2026-05-16",
  notes: null,
};

describe("budget line to item matching", () => {
  it("is high confidence when price, date, and words all agree", () => {
    const result = scoreLineItemMatch(line, lens);
    expect(result?.confidence).toBe("high");
    expect(result?.reasons).toEqual(expect.arrayContaining(["Same price"]));
  });

  it("treats a PO number in the item notes as the strongest signal", () => {
    const result = scoreLineItemMatch(line, { ...lens, purchasePriceCents: null, purchaseDate: null, brand: "Other", model: "Thing", notes: "Bought on PO-00177267" });
    expect(result?.score).toBeGreaterThanOrEqual(70);
    expect(result?.reasons[0]).toContain("PO-00177267");
  });

  it("accepts a price within about 3% but scores it lower than an exact one", () => {
    const exact = scoreLineItemMatch(line, lens)!;
    const close = scoreLineItemMatch(line, { ...lens, purchasePriceCents: 190_000 })!;
    expect(close.score).toBeLessThan(exact.score);
    expect(close.reasons).toContain("Price within about 3%");
  });

  it("does not suggest an unrelated item that only shares a date", () => {
    const unrelated: MatchItem = { name: null, brand: "Manfrotto", model: "Tripod", purchasePriceCents: 48_759, purchaseDate: "2026-05-15", notes: null };
    expect(scoreLineItemMatch(line, unrelated)).toBeNull();
  });

  it("does not match short PO fragments in notes", () => {
    const result = scoreLineItemMatch({ ...line, poNumber: "PO1", orderNumber: null }, { ...lens, purchasePriceCents: null, purchaseDate: null, brand: "Zed", model: "Q", notes: "PO1" });
    expect(result).toBeNull();
  });

  it("drops filler words when comparing text", () => {
    expect(tokens("The Sony Camera Kit, 24-70mm!")).toEqual(["sony", "24", "70mm"]);
  });
});
