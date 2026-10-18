import { describe, expect, it } from "vitest";
import type { OrderPlan } from "@/lib/gear-picks/order";
import { SIZE_NEEDED } from "@/lib/gear-picks/order";
import { orderPhase, receivingRows } from "@/lib/gear-picks/receiving";

const plan: OrderPlan = {
  pieces: 5,
  pickCents: 0,
  missingSizePeople: [],
  studentShoes: 0,
  lines: [
    { sku: "6021649-834", itemName: "Athletics SS Tee", colorLabel: "Red", source: "CORE_KIT", sizes: [{ size: "M", quantity: 2 }, { size: SIZE_NEEDED, quantity: 1 }], quantity: 3, totalCents: 0 },
    { sku: "6021649-834", itemName: "Athletics SS Tee", colorLabel: "Red", source: "PICK", sizes: [{ size: "M", quantity: 1 }, { size: "L", quantity: 1 }], quantity: 2, totalCents: 0 },
  ],
};

describe("receivingRows", () => {
  it("merges sources by SKU and size and leaves out units without a size", () => {
    const rows = receivingRows(plan, []);
    expect(rows.map((row) => [row.size, row.ordered, row.received, row.outstanding])).toEqual([
      ["L", 1, 0, 1],
      ["M", 3, 0, 3],
    ]);
  });

  it("subtracts receipts, shows over-receipts as negative, and keeps items not on the order", () => {
    const rows = receivingRows(plan, [
      { sku: "6021649-834", size: "M", quantity: 2 },
      { sku: "6021649-834", size: "L", quantity: 2 },
      { sku: "6099999-001", size: null, quantity: 1 },
    ]);
    expect(rows.find((row) => row.size === "M")!.outstanding).toBe(1);
    expect(rows.find((row) => row.size === "L")!.outstanding).toBe(-1);
    expect(rows.find((row) => row.sku === "6099999-001")).toMatchObject({ ordered: 0, received: 1 });
  });
});

describe("orderPhase", () => {
  it("moves from planning to ordered to receiving to received", () => {
    expect(orderPhase({ placedAt: null }, receivingRows(plan, []))).toBe("PLANNING");
    expect(orderPhase({ placedAt: "2026-10-20T00:00:00Z" }, receivingRows(plan, []))).toBe("ORDERED");
    expect(orderPhase({ placedAt: "2026-10-20T00:00:00Z" }, receivingRows(plan, [{ sku: "6021649-834", size: "M", quantity: 1 }]))).toBe("RECEIVING");
    const all = [{ sku: "6021649-834", size: "M", quantity: 3 }, { sku: "6021649-834", size: "L", quantity: 1 }];
    expect(orderPhase({ placedAt: "2026-10-20T00:00:00Z" }, receivingRows(plan, all))).toBe("RECEIVED");
  });
});
