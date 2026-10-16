import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  checkRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    budget: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    budgetLine: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    budgetLineItem: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
    bulkSku: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    db: {
      budget: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(),
      _mockTx: tx,
    },
  };
});

import { requireAuth } from "@/lib/auth";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { GET as listBudgets, POST as createBudget } from "@/app/api/budget/route";
import { GET as getBudget } from "@/app/api/budget/[id]/route";
import { POST as createLine } from "@/app/api/budget/[id]/lines/route";
import { DELETE as deleteLine, PATCH as patchLine } from "@/app/api/budget/lines/[lineId]/route";
import { POST as linkItem } from "@/app/api/budget/lines/[lineId]/links/route";
import { DELETE as unlinkItem } from "@/app/api/budget/links/[linkId]/route";
import { POST as applyOrder } from "@/app/api/budget/links/[linkId]/apply/route";

type MockFn = ReturnType<typeof vi.fn>;
const tx = (db as unknown as { _mockTx: Record<string, Record<string, MockFn>> })._mockTx;
const ORIGIN = "https://app.example.com";
const staff = { id: "user-1", name: "Staff", email: "s@example.com", role: Role.STAFF, avatarUrl: null };
const admin = { ...staff, id: "admin-1", name: "Admin", role: Role.ADMIN };

const idContext = { params: Promise.resolve({ id: "budget-1" }) };
const lineContext = { params: Promise.resolve({ lineId: "line-1" }) };
const linkContext = { params: Promise.resolve({ linkId: "link-1" }) };

function json(method: string, path: string, body?: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const lineRow = {
  id: "line-1",
  budgetId: "budget-1",
  category: "EQUIPMENT",
  status: "PLANNED",
  description: "Sony FX3 Body",
  supplier: "B&H Photo",
  unitCostCents: 399_764,
  quantity: 2,
  quantityBought: null,
  spentCents: null,
  purchasedOn: null,
  orderNumber: null,
  poNumber: null,
  linkUrl: null,
  justification: null,
  requesterUserId: null,
  requesterNote: null,
  requester: null,
  items: [],
};

beforeEach(() => {
  for (const model of Object.values(tx)) for (const fn of Object.values(model)) fn.mockReset();
  vi.mocked(createAuditEntryTx).mockReset();
  vi.mocked(db.$transaction).mockImplementation((async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
  vi.mocked(requireAuth).mockResolvedValue(admin);
  vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
});

describe("budget access", () => {
  it("keeps staff out of every route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staff);
    expect((await listBudgets(new Request(`${ORIGIN}/api/budget`), idContext)).status).toBe(403);
    expect((await getBudget(new Request(`${ORIGIN}/api/budget/budget-1`), idContext)).status).toBe(403);
    expect((await createBudget(json("POST", "/api/budget", { name: "Creative", fiscalYear: "2026-27" }), idContext)).status).toBe(403);
    expect((await createLine(json("POST", "/api/budget/budget-1/lines", {}), idContext)).status).toBe(403);
    expect((await patchLine(json("PATCH", "/api/budget/lines/line-1", { quantity: 3 }), lineContext)).status).toBe(403);
    expect((await deleteLine(json("DELETE", "/api/budget/lines/line-1"), lineContext)).status).toBe(403);
    expect((await linkItem(json("POST", "/api/budget/lines/line-1/links", { assetId: "a1" }), lineContext)).status).toBe(403);
    expect((await unlinkItem(json("DELETE", "/api/budget/links/link-1"), linkContext)).status).toBe(403);
    expect((await applyOrder(json("POST", "/api/budget/links/link-1/apply", { fields: ["notes"] }), linkContext)).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("budget routes", () => {
  it("lists budgets with their line counts", async () => {
    vi.mocked(db.budget.findMany).mockResolvedValue([
      { id: "budget-1", name: "Creative", fiscalYear: "2026-27", allocationCents: null, _count: { lines: 3 } },
    ] as never);
    const response = await listBudgets(new Request(`${ORIGIN}/api/budget`), idContext);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([
      { id: "budget-1", name: "Creative", fiscalYear: "2026-27", allocationCents: null, lineCount: 3 },
    ]);
  });

  it("rejects a fiscal year that isn't YYYY-YY", async () => {
    const response = await createBudget(json("POST", "/api/budget", { name: "Creative", fiscalYear: "2026" }), idContext);
    expect(response.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates a budget and audits it", async () => {
    tx.budget!.create!.mockResolvedValue({ id: "budget-1", name: "Football", fiscalYear: "2026-27", allocationCents: null });
    const response = await createBudget(json("POST", "/api/budget", { name: "Football", fiscalYear: "2026-27" }), idContext);
    expect(response.status).toBe(201);
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: "budget", action: "create", actorId: "admin-1", actorRole: Role.ADMIN }),
    );
  });

  it("adds a line, normalizes blanks, and audits it", async () => {
    tx.budget!.findUnique!.mockResolvedValue({ id: "budget-1" });
    tx.budgetLine!.create!.mockResolvedValue(lineRow);
    const response = await createLine(
      json("POST", "/api/budget/budget-1/lines", {
        category: "EQUIPMENT",
        description: "Sony FX3 Body",
        supplier: "  ",
        unitCostCents: 399_764,
        quantity: 2,
        poNumber: "PO-00177267",
      }),
      idContext,
    );
    expect(response.status).toBe(201);
    expect(tx.budgetLine!.create!.mock.calls[0]![0].data).toMatchObject({
      budgetId: "budget-1",
      supplier: null,
      poNumber: "PO-00177267",
      status: "PLANNED",
    });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ entityType: "budget_line", action: "create" }));
  });

  it("rejects negative money and non-http links", async () => {
    const bad = await createLine(
      json("POST", "/api/budget/budget-1/lines", { category: "EQUIPMENT", description: "x", unitCostCents: -1 }),
      idContext,
    );
    expect(bad.status).toBe(400);
    const badLink = await createLine(
      json("POST", "/api/budget/budget-1/lines", { category: "EQUIPMENT", description: "x", unitCostCents: 1, linkUrl: "javascript:alert(1)" }),
      idContext,
    );
    expect(badLink.status).toBe(400);
  });

  it("returns 404 when the budget doesn't exist", async () => {
    tx.budget!.findUnique!.mockResolvedValue(null);
    const response = await createLine(
      json("POST", "/api/budget/budget-1/lines", { category: "RENTALS", description: "Gear rental", unitCostCents: 1000 }),
      idContext,
    );
    expect(response.status).toBe(404);
  });

  it("updates a line with before and after in the audit entry", async () => {
    tx.budgetLine!.findUnique!.mockResolvedValue(lineRow);
    tx.budgetLine!.update!.mockResolvedValue({ ...lineRow, status: "PURCHASED", spentCents: 799_528 });
    const response = await patchLine(
      json("PATCH", "/api/budget/lines/line-1", { status: "PURCHASED", spentCents: 799_528, purchasedOn: "2026-05-14" }),
      lineContext,
    );
    expect(response.status).toBe(200);
    expect(tx.budgetLine!.update!.mock.calls[0]![0].data.purchasedOn).toEqual(new Date("2026-05-14T00:00:00.000Z"));
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "update",
        before: expect.objectContaining({ status: "PLANNED" }),
        after: expect.objectContaining({ status: "PURCHASED", spentCents: 799_528 }),
      }),
    );
  });

  it("deletes a line and records what it was", async () => {
    tx.budgetLine!.findUnique!.mockResolvedValue(lineRow);
    const response = await deleteLine(json("DELETE", "/api/budget/lines/line-1"), lineContext);
    expect(response.status).toBe(200);
    expect(tx.budgetLine!.delete!).toHaveBeenCalledWith({ where: { id: "line-1" } });
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "delete", before: expect.objectContaining({ description: "Sony FX3 Body" }) }),
    );
  });
});

describe("budget item links", () => {
  it("links a line to an asset and audits it", async () => {
    tx.budgetLine!.findUnique!.mockResolvedValue({ id: "line-1", description: "Sony FX3 Body" });
    tx.asset!.findUnique!.mockResolvedValue({ id: "asset-1" });
    tx.budgetLineItem!.create!.mockResolvedValue({ id: "link-1", assetId: "asset-1", bulkSkuId: null, quantity: 1 });
    const response = await linkItem(json("POST", "/api/budget/lines/line-1/links", { assetId: "asset-1" }), lineContext);
    expect(response.status).toBe(201);
    expect(tx.budgetLineItem!.create!.mock.calls[0]![0].data).toMatchObject({ budgetLineId: "line-1", assetId: "asset-1", bulkSkuId: null, quantity: 1, createdById: "admin-1" });
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ entityType: "budget_line_item", action: "link" }));
  });

  it("keeps the quantity for a bulk item and ignores it for an asset", async () => {
    tx.budgetLine!.findUnique!.mockResolvedValue({ id: "line-1", description: "Batteries" });
    tx.bulkSku!.findUnique!.mockResolvedValue({ id: "sku-1" });
    tx.budgetLineItem!.create!.mockResolvedValue({ id: "link-2", assetId: null, bulkSkuId: "sku-1", quantity: 20 });
    await linkItem(json("POST", "/api/budget/lines/line-1/links", { bulkSkuId: "sku-1", quantity: 20 }), lineContext);
    expect(tx.budgetLineItem!.create!.mock.calls[0]![0].data).toMatchObject({ bulkSkuId: "sku-1", assetId: null, quantity: 20 });
  });

  it("requires exactly one target", async () => {
    expect((await linkItem(json("POST", "/api/budget/lines/line-1/links", {}), lineContext)).status).toBe(400);
    expect((await linkItem(json("POST", "/api/budget/lines/line-1/links", { assetId: "a", bulkSkuId: "b" }), lineContext)).status).toBe(400);
  });

  it("returns 404 for a missing item and unlinks with an audit entry", async () => {
    tx.budgetLine!.findUnique!.mockResolvedValue({ id: "line-1", description: "x" });
    tx.asset!.findUnique!.mockResolvedValue(null);
    expect((await linkItem(json("POST", "/api/budget/lines/line-1/links", { assetId: "gone" }), lineContext)).status).toBe(404);

    tx.budgetLineItem!.findUnique!.mockResolvedValue({ id: "link-1", budgetLineId: "line-1", assetId: "asset-1", bulkSkuId: null, quantity: 1 });
    const response = await unlinkItem(json("DELETE", "/api/budget/links/link-1"), linkContext);
    expect(response.status).toBe(200);
    expect(createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "unlink", entityId: "link-1" }));
  });
});

describe("fill an item from its order", () => {
  const linked = {
    id: "link-1",
    asset: { id: "asset-1", purchaseDate: null, purchasePrice: null, linkUrl: null, notes: "Cage included" },
    budgetLine: {
      description: "Sony FX3 Body",
      supplier: "B&H Photo",
      unitCostCents: 399_764,
      quantityBought: 2,
      spentCents: 800_000,
      purchasedOn: new Date("2026-05-28T00:00:00.000Z"),
      poNumber: "PO-00177267",
      orderNumber: "1129416779",
      linkUrl: "https://www.bhphotovideo.com/c/product/fx3",
      budget: { name: "Creative", fiscalYear: "2025-26" },
    },
  };

  it("fills the chosen fields, appends to notes, and audits the item", async () => {
    tx.budgetLineItem!.findUnique!.mockResolvedValue(linked);
    const response = await applyOrder(
      json("POST", "/api/budget/links/link-1/apply", { fields: ["purchaseDate", "purchasePrice", "linkUrl", "notes"] }),
      linkContext,
    );
    expect(response.status).toBe(200);
    const update = tx.asset!.update!.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(String(update.data.purchasePrice)).toBe("4000");
    expect(update.data.linkUrl).toBe("https://www.bhphotovideo.com/c/product/fx3");
    expect(update.data.notes).toBe(
      "Cage included\nBought from B&H Photo · PO-00177267 · Order 1129416779 · Creative 2025-26 budget",
    );
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entityType: "asset", entityId: "asset-1", action: "fill_from_order" }),
    );
  });

  it("only touches the fields it was asked to", async () => {
    tx.budgetLineItem!.findUnique!.mockResolvedValue(linked);
    await applyOrder(json("POST", "/api/budget/links/link-1/apply", { fields: ["linkUrl"] }), linkContext);
    const update = tx.asset!.update!.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(update.data)).toEqual(["linkUrl"]);
  });

  it("rejects bulk links, unknown fields, and missing links", async () => {
    tx.budgetLineItem!.findUnique!.mockResolvedValue({ ...linked, asset: null });
    expect((await applyOrder(json("POST", "/api/budget/links/link-1/apply", { fields: ["notes"] }), linkContext)).status).toBe(400);
    expect((await applyOrder(json("POST", "/api/budget/links/link-1/apply", { fields: ["name"] }), linkContext)).status).toBe(400);
    tx.budgetLineItem!.findUnique!.mockResolvedValue(null);
    expect((await applyOrder(json("POST", "/api/budget/links/link-1/apply", { fields: ["notes"] }), linkContext)).status).toBe(404);
    expect(tx.asset!.update!).not.toHaveBeenCalled();
  });
});
