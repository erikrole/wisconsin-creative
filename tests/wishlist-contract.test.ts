import { describe, expect, it } from "vitest";
import { linkDomain, parseQuickAdd, pendingWishCents, wishCounts } from "@/lib/wishlist/contract";
import { createWishSchema, promoteWishSchema, updateWishSchema } from "@/lib/wishlist/schemas";

describe("wish list contract", () => {
  it("totals only open and approved wishes, times quantity", () => {
    expect(
      pendingWishCents([
        { status: "OPEN", estimateCents: 80_000, quantity: 1 },
        { status: "APPROVED", estimateCents: 34_900, quantity: 2 },
        { status: "IN_BUDGET", estimateCents: 219_900, quantity: 1 },
        { status: "DECLINED", estimateCents: 180_000, quantity: 1 },
        { status: "OPEN", estimateCents: null, quantity: 3 },
      ]),
    ).toBe(149_800);
  });

  it("counts wishes by status", () => {
    expect(wishCounts([{ status: "OPEN" }, { status: "OPEN" }, { status: "DECLINED" }])).toEqual({
      OPEN: 2,
      APPROVED: 0,
      IN_BUDGET: 0,
      DECLINED: 1,
      ALL: 3,
    });
  });

  it("reads the domain from a link and rejects non-web links", () => {
    expect(linkDomain("https://www.bhphotovideo.com/c/product/1")).toBe("bhphotovideo.com");
    expect(linkDomain("javascript:alert(1)")).toBeNull();
    expect(linkDomain("not a link")).toBeNull();
    expect(linkDomain(null)).toBeNull();
  });

  it("turns quick-add text into a link or a title", () => {
    expect(parseQuickAdd("https://dji.com/mic-2")).toEqual({ title: "Item from dji.com", linkUrl: "https://dji.com/mic-2" });
    expect(parseQuickAdd("  Lens cleaning kit ")).toEqual({ title: "Lens cleaning kit", linkUrl: null });
    expect(parseQuickAdd("   ")).toBeNull();
  });
});

describe("wish list schemas", () => {
  it("defaults quantity and accepts a minimal wish", () => {
    expect(createWishSchema.parse({ title: "Tripod" }).quantity).toBe(1);
  });

  it("rejects non-http links and out-of-range money", () => {
    expect(() => createWishSchema.parse({ title: "x", linkUrl: "ftp://x" })).toThrow();
    expect(() => createWishSchema.parse({ title: "x", estimateCents: -1 })).toThrow();
  });

  it("only lets an update move a wish to open, approved, or declined", () => {
    expect(updateWishSchema.parse({ status: "APPROVED" })).toEqual({ status: "APPROVED" });
    expect(() => updateWishSchema.parse({ status: "IN_BUDGET" })).toThrow();
    expect(() => updateWishSchema.parse({})).toThrow();
  });

  it("requires a budget, category and cost to move a wish into the budget", () => {
    expect(promoteWishSchema.parse({ budgetId: "b1", category: "EQUIPMENT", unitCostCents: 79_900, quantity: 1 }).unplanned).toBe(false);
    expect(() => promoteWishSchema.parse({ budgetId: "b1", category: "NOPE", unitCostCents: 1, quantity: 1 })).toThrow();
  });
});
