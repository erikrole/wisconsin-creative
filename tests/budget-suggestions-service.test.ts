import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { db, audit } = vi.hoisted(() => {
  const db = {
    budget: { findUnique: vi.fn(), update: vi.fn() },
    budgetLine: { findUnique: vi.fn(), findMany: vi.fn() },
    asset: { findUnique: vi.fn(), findMany: vi.fn() },
    bulkSku: { findMany: vi.fn() },
    gearPickCycle: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, audit: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: audit }));

import { getBudgetDetail, searchItemsToLink, suggestItemsForLine, suggestLinesForAsset, updateBudget } from "@/lib/services/budget";

const actor = { id: "admin-1", role: "ADMIN" as const };
const may14 = new Date("2026-05-14T00:00:00.000Z");

const fx3Line = {
  description: "Sony FX3 Cinema Camera Body",
  supplier: "B&H Photo",
  unitCostCents: 399_800, unitCostKnown: true,
  quantity: 3,
  quantityBought: 2,
  purchasedOn: may14,
  poNumber: "PO-00177267",
  orderNumber: null,
};

function asset(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    assetTag: id.toUpperCase(),
    name: null,
    brand: "Sony",
    model: "FX3",
    purchasePrice: new Prisma.Decimal("3998.00"),
    purchaseDate: may14,
    notes: null,
    imageUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.asset.findMany.mockResolvedValue([]);
  db.bulkSku.findMany.mockResolvedValue([]);
  db.budgetLine.findMany.mockResolvedValue([]);
  db.gearPickCycle.findMany.mockResolvedValue([]);
});

describe("suggestItemsForLine", () => {
  it("ranks unlinked items that match the order, best first, and drops weak ones", async () => {
    db.budgetLine.findUnique.mockResolvedValue(fx3Line);
    db.asset.findMany.mockResolvedValue([
      asset("roam2", { brand: "DJI", model: "RS 4", purchasePrice: new Prisma.Decimal("549.00"), purchaseDate: new Date("2025-01-01T00:00:00Z") }),
      asset("fx3-b", { notes: null }),
      asset("fx3-a", { notes: "Bought on PO-00177267" }),
    ]);
    db.bulkSku.findMany.mockResolvedValue([
      { id: "sd", name: "Sony FX3 cage", purchasePrice: new Prisma.Decimal("3998.00"), notes: null, imageUrl: "sd.png" },
    ]);

    const suggestions = await suggestItemsForLine("line-1");

    expect(suggestions.map((s) => s.targetId)).toEqual(["fx3-a", "fx3-b", "sd"]);
    expect(suggestions[0]).toMatchObject({ kind: "asset", label: "Sony FX3", detail: "FX3-A", href: "/items/fx3-a", suggestedQuantity: 1, confidence: "high" });
    expect(suggestions[0]!.reasons).toContain("Item notes mention PO-00177267");
    // A bulk item takes the quantity actually bought.
    expect(suggestions[2]).toMatchObject({ kind: "bulk", detail: "Bulk item", href: "/bulk-inventory/sd", suggestedQuantity: 2 });
  });

  it("searches only unlinked, unretired items near the price, the date, or the words", async () => {
    db.budgetLine.findUnique.mockResolvedValue(fx3Line);

    await suggestItemsForLine("line-1");

    const where = db.asset.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ status: { not: "RETIRED" }, budgetLines: { none: {} } });
    expect(where.OR[0]).toEqual({ purchasePrice: { gte: 3998 * 0.97, lte: 3998 * 1.03 } });
    expect(where.OR[1]).toEqual({ purchaseDate: { gte: new Date("2026-03-15T00:00:00.000Z"), lte: new Date("2026-07-13T00:00:00.000Z") } });
    expect(where.OR).toContainEqual({ model: { contains: "cinema", mode: "insensitive" } });
    expect(db.bulkSku.findMany.mock.calls[0]?.[0]?.where?.active).toBe(true);
  });

  it("leaves out the date window for a line not yet bought", async () => {
    db.budgetLine.findUnique.mockResolvedValue({ ...fx3Line, purchasedOn: null, quantityBought: null });

    await suggestItemsForLine("line-1");

    expect(JSON.stringify(db.asset.findMany.mock.calls[0]?.[0]?.where)).not.toContain("purchaseDate");
  });

  it("answers 404 for a missing line", async () => {
    db.budgetLine.findUnique.mockResolvedValue(null);
    await expect(suggestItemsForLine("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("suggestLinesForAsset", () => {
  const budget = { id: "b1", name: "Creative", fiscalYear: "2025-26" };
  const assetRow = {
    name: null, brand: "Sony", model: "FX3", imageUrl: "fx3.png", serialNumber: "SN1",
    purchasePrice: new Prisma.Decimal("3998.00"), purchaseDate: may14, linkUrl: null, notes: null, budgetLines: [] as unknown[],
  };

  it("shows the orders already linked, with what the item could take from them, and suggests nothing", async () => {
    db.asset.findUnique.mockResolvedValue({
      ...assetRow,
      purchaseDate: null,
      budgetLines: [{
        id: "link-1",
        budgetLine: { id: "line-1", ...fx3Line, spentCents: 799_600, linkUrl: "https://bhphotovideo.com/fx3", budget },
      }],
    });

    const result = await suggestLinesForAsset("fx3");

    expect(result).toMatchObject({ serialNumber: "SN1", imageUrl: "fx3.png", suggestions: [] });
    expect(result.linked[0]).toMatchObject({ linkId: "link-1", lineId: "line-1", budgetName: "Creative", purchasedOn: "2026-05-14" });
    expect(result.linked[0]!.autofill.map((field) => field.field)).toContain("purchaseDate");
    expect(db.budgetLine.findMany).not.toHaveBeenCalled();
  });

  it("suggests matching lines that weren't cancelled, best first", async () => {
    db.asset.findUnique.mockResolvedValue(assetRow);
    db.budgetLine.findMany.mockResolvedValue([
      { id: "far", description: "Tripod", supplier: null, unitCostCents: 20_000, purchasedOn: null, poNumber: null, orderNumber: null, budget },
      { id: "near", ...fx3Line, budget },
    ]);

    const result = await suggestLinesForAsset("fx3");

    expect(result.suggestions.map((s) => s.lineId)).toEqual(["near"]);
    expect(result.suggestions[0]).toMatchObject({ budgetName: "Creative", fiscalYear: "2025-26", purchasedOn: "2026-05-14", poNumber: "PO-00177267" });
    const where = db.budgetLine.findMany.mock.calls[0]?.[0]?.where;
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.OR[0]).toEqual({ unitCostCents: { gte: Math.floor(399_800 * 0.97), lte: Math.ceil(399_800 * 1.03) } });
  });

  it("answers 404 for a missing item", async () => {
    db.asset.findUnique.mockResolvedValue(null);
    await expect(suggestLinesForAsset("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("searchItemsToLink", () => {
  it("needs two characters, then finds items and bulk items", async () => {
    expect(await searchItemsToLink(" x ")).toEqual([]);
    expect(db.asset.findMany).not.toHaveBeenCalled();

    db.asset.findMany.mockResolvedValue([
      { id: "a1", assetTag: "SLOW1", name: "  ", brand: "Sony", model: "FX3", imageUrl: null },
      { id: "a2", assetTag: "ROAM2", name: "Gimbal", brand: "DJI", model: "RS 4", imageUrl: "g.png" },
    ]);
    db.bulkSku.findMany.mockResolvedValue([{ id: "k1", name: "NP-FZ100 battery", imageUrl: null }]);

    expect(await searchItemsToLink("  so ")).toEqual([
      { kind: "asset", targetId: "a1", label: "Sony FX3", imageUrl: null, detail: "SLOW1" },
      { kind: "asset", targetId: "a2", label: "Gimbal", imageUrl: "g.png", detail: "ROAM2" },
      { kind: "bulk", targetId: "k1", label: "NP-FZ100 battery", imageUrl: null, detail: "Bulk item" },
    ]);
    expect(JSON.stringify(db.asset.findMany.mock.calls[0]?.[0]?.where)).toContain('"serialNumber":{"contains":"so"');
  });
});

describe("updateBudget", () => {
  it("saves the allocation and notes with before and after in the audit", async () => {
    db.budget.findUnique.mockResolvedValue({ id: "b1", allocationCents: 100_000, notes: null });
    db.budget.update.mockResolvedValue({ id: "b1", allocationCents: 150_000, notes: "Raised" });

    const after = await updateBudget(actor, "b1", { allocationCents: 150_000, notes: "Raised" });

    expect(after.allocationCents).toBe(150_000);
    expect(audit).toHaveBeenCalledWith(db, expect.objectContaining({
      entityType: "budget",
      action: "update",
      before: { id: "b1", allocationCents: 100_000, notes: null },
      after: { id: "b1", allocationCents: 150_000, notes: "Raised" },
    }));
  });

  it("answers 404 without writing for a missing budget", async () => {
    db.budget.findUnique.mockResolvedValue(null);
    await expect(updateBudget(actor, "nope", { allocationCents: 1 })).rejects.toMatchObject({ status: 404 });
    expect(db.budget.update).not.toHaveBeenCalled();
  });
});

describe("getBudgetDetail links", () => {
  it("labels linked items and bulk items for the line", async () => {
    db.budget.findUnique.mockResolvedValue({
      id: "b1", name: "Creative", fiscalYear: "2026-27", allocationCents: 0, notes: null,
      lines: [{
        id: "line-1", status: "PURCHASED", category: "EQUIPMENT", unitCostCents: 100, quantity: 1, spentCents: 100, unplanned: false, refundCents: null,
        purchasedOn: may14, requester: null,
        items: [
          { id: "l1", quantity: 1, asset: { id: "a1", assetTag: "SLOW1", serialNumber: "123", name: null, brand: "Sony", model: "FX3", imageUrl: null }, bulkSku: null },
          { id: "l2", quantity: 4, asset: null, bulkSku: { id: "k1", name: "SD cards", imageUrl: "sd.png" } },
          { id: "l3", quantity: 1, asset: { id: "a2", assetTag: "ROAM2", serialNumber: null, name: "Gimbal", brand: "DJI", model: "RS 4", imageUrl: null }, bulkSku: null },
        ],
      }],
    });

    const detail = await getBudgetDetail("b1");

    expect(detail.lines[0]!.purchasedOn).toBe("2026-05-14");
    expect(detail.lines[0]!.links).toEqual([
      { id: "l1", quantity: 1, kind: "asset", targetId: "a1", label: "Sony FX3", imageUrl: null, detail: "SLOW1 · SN 123", href: "/items/a1" },
      { id: "l2", quantity: 4, kind: "bulk", targetId: "k1", label: "SD cards", imageUrl: "sd.png", detail: null, href: "/bulk-inventory/k1" },
      { id: "l3", quantity: 1, kind: "asset", targetId: "a2", label: "Gimbal", imageUrl: null, detail: "ROAM2", href: "/items/a2" },
    ]);
  });
});
