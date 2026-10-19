import { describe, expect, it } from "vitest";
import { applyNote, buildAutofill, purchaseNote, unitPriceCents, type AutofillLine } from "@/lib/budget/autofill";

const line: AutofillLine = {
  description: "Sony FX3 Body",
  supplier: "B&H Photo",
  unitCostCents: 399_764,
  quantityBought: 2,
  spentCents: 800_000,
  purchasedOn: "2026-05-28",
  poNumber: "PO-00177267",
  orderNumber: "1129416779",
  linkUrl: "https://example.com/fx3",
  budgetName: "Creative",
  fiscalYear: "2025-26",
};
const empty = { purchaseDate: null, purchasePriceCents: null, linkUrl: null, notes: null };

describe("unitPriceCents", () => {
  it("divides real spend by units bought, else uses the planned unit cost", () => {
    expect(unitPriceCents(line)).toBe(400_000);
    expect(unitPriceCents({ ...line, spentCents: null })).toBe(399_764);
    expect(unitPriceCents({ ...line, quantityBought: null })).toBe(399_764);
  });
});

describe("buildAutofill", () => {
  it("proposes every detail as fill for a bare item", () => {
    const proposals = buildAutofill(line, empty);
    expect(proposals.map((p) => [p.field, p.status])).toEqual([
      ["purchaseDate", "fill"],
      ["purchasePrice", "fill"],
      ["linkUrl", "fill"],
      ["notes", "fill"],
    ]);
  });

  it("marks matching values same and other values differs, never overwriting silently", () => {
    const proposals = buildAutofill(line, {
      purchaseDate: "2026-05-28",
      purchasePriceCents: 350_000,
      linkUrl: "https://old.example.com",
      notes: purchaseNote(line),
    });
    const byField = Object.fromEntries(proposals.map((p) => [p.field, p.status]));
    expect(byField).toEqual({ purchaseDate: "same", purchasePrice: "differs", linkUrl: "differs", notes: "same" });
  });

  it("skips date and link when the order has none", () => {
    const fields = buildAutofill({ ...line, purchasedOn: null, linkUrl: null }, empty).map((p) => p.field);
    expect(fields).toEqual(["purchasePrice", "notes"]);
  });
});

describe("applyNote", () => {
  it("appends the trail to existing notes and is idempotent", () => {
    const once = applyNote("Cage included", line);
    expect(once.startsWith("Cage included\n")).toBe(true);
    expect(applyNote(once, line)).toBe(once);
    expect(applyNote(null, line)).toBe(purchaseNote(line));
  });
});
