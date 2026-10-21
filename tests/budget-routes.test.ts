import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import ExcelJS from "exceljs";

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
    budgetLine: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    budgetLineItem: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    asset: { findUnique: vi.fn(), update: vi.fn() },
    bulkSku: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    db: {
      budget: { findMany: vi.fn(), findUnique: vi.fn() },
      auditLog: { findMany: vi.fn() },
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
import { POST as bulkLines } from "@/app/api/budget/[id]/lines/bulk/route";
import { POST as previewImport, PUT as commitImport } from "@/app/api/budget/[id]/import/route";
import { GET as budgetTrend } from "@/app/api/budget/trend/route";
import { GET as lineHistory } from "@/app/api/budget/lines/[lineId]/history/route";
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

  it("rejects dates that look right but don't exist", async () => {
    for (const purchasedOn of ["2026-13-45", "2026-02-30"]) {
      const response = await createLine(
        json("POST", "/api/budget/budget-1/lines", { category: "EQUIPMENT", description: "x", unitCostCents: 100, purchasedOn }),
        idContext,
      );
      expect(response.status).toBe(400);
    }
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

describe("bulk changes and history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.$transaction as unknown as MockFn).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  it("drops several lines and returns their previous values for undo", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.budgetLine!.findMany!.mockResolvedValue([
      { id: "l1", status: "PLANNED", category: "EQUIPMENT" },
      { id: "l2", status: "ORDERED", category: "RENTALS" },
    ]);
    const res = await bulkLines(json("POST", "/api/budget/budget-1/lines/bulk", { lineIds: ["l1", "l2"], status: "CANCELLED" }), idContext);
    expect(res.status).toBe(200);
    expect(tx.budgetLine!.updateMany!.mock.calls[0]![0].data).toEqual({ status: "CANCELLED" });
    expect((await res.json()).data.previous).toHaveLength(2);
    expect(createAuditEntryTx).toHaveBeenCalledTimes(2);
  });

  it("refuses a bulk change that names a line from another budget", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.budgetLine!.findMany!.mockResolvedValue([{ id: "l1", status: "PLANNED", category: "EQUIPMENT" }]);
    const res = await bulkLines(json("POST", "/api/budget/budget-1/lines/bulk", { lineIds: ["l1", "other"], status: "CANCELLED" }), idContext);
    expect(res.status).toBe(404);
    expect(tx.budgetLine!.updateMany!).not.toHaveBeenCalled();
  });

  it("keeps bulk changes and history admin only", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    expect((await bulkLines(json("POST", "/api/budget/budget-1/lines/bulk", { lineIds: ["l1"], status: "CANCELLED" }), idContext)).status).toBe(403);
    expect((await lineHistory(json("GET", "/api/budget/lines/line-1/history"), lineContext)).status).toBe(403);
  });

  it("reads a line's history in plain words", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    (db.auditLog.findMany as unknown as MockFn).mockResolvedValue([
      {
        id: "a1",
        action: "update",
        createdAt: new Date("2026-06-10T12:00:00Z"),
        beforeJson: { status: "PLANNED", spentCents: null },
        afterJson: { status: "PURCHASED", spentCents: 129_600 },
        actor: { name: "Erik" },
      },
    ]);
    const body = await (await lineHistory(json("GET", "/api/budget/lines/line-1/history"), lineContext)).json();
    expect(body.data[0].actorName).toBe("Erik");
    expect(body.data[0].changes).toEqual([
      { field: "status", label: "Status", from: "Planned", to: "Purchased" },
      { field: "spentCents", label: "Spent", from: "none", to: "$1,296" },
    ]);
  });
});

describe("year over year", () => {
  it("totals one budget name across fiscal years, admin only", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    expect((await budgetTrend(json("GET", "/api/budget/trend?name=Creative"), { params: Promise.resolve({}) })).status).toBe(403);

    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    (db.budget.findMany as unknown as MockFn).mockResolvedValue([
      {
        fiscalYear: "2025-26",
        allocationCents: 3_000_000,
        lines: [
          { status: "PURCHASED", category: "EQUIPMENT", unitCostCents: 100_00, quantity: 1, spentCents: 110_00, refundCents: null, unplanned: false },
          { status: "CANCELLED", category: "EQUIPMENT", unitCostCents: 50_00, quantity: 1, spentCents: null, refundCents: null, unplanned: false },
        ],
      },
    ]);
    const res = await budgetTrend(json("GET", "/api/budget/trend?name=Creative"), { params: Promise.resolve({}) });
    expect((await res.json()).data).toEqual([
      { fiscalYear: "2025-26", submittedCents: 150_00, spentCents: 110_00, forecastCents: 110_00, allocationCents: 3_000_000 },
    ]);
    expect((await budgetTrend(json("GET", "/api/budget/trend"), { params: Promise.resolve({}) })).status).toBe(400);
  });
});

describe("spreadsheet import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.$transaction as unknown as MockFn).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  function upload(csv: string, name = "FY26.csv") {
    const form = new FormData();
    form.set("file", new File([csv], name, { type: "text/csv" }));
    return new Request(`${ORIGIN}/api/budget/budget-1/import`, { method: "POST", headers: { origin: ORIGIN }, body: form });
  }

  it("previews a sheet without saving anything", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    (db.budget.findUnique as unknown as MockFn).mockResolvedValue({
      id: "budget-1",
      name: "Creative",
      fiscalYear: "2025-26",
      allocationCents: null,
      notes: null,
      lines: [],
    });
    const res = await previewImport(upload("Item,Qty,Budgeted,Spent,Month\nSony FX3,1,$7995,$8000,May 28\nTotal,,$7995,$8000,\n"), idContext);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.candidates.map((c: { description: string; result: string }) => [c.description, c.result])).toEqual([
      ["Sony FX3", "ready"],
      ["Total", "skipped"],
    ]);
    expect(data.candidates[0].purchasedOn).toBe("2026-05-28");
    expect(tx.budgetLine!.create!).not.toHaveBeenCalled();
  });

  it("offers the tabs of a workbook and previews the one for the budget's year", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    (db.budget.findUnique as unknown as MockFn).mockResolvedValue({ id: "budget-2", name: "Football", fiscalYear: "2026-27", allocationCents: null, notes: null, lines: [] });
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("27-28").addRow(["G/S pass"]);
    const creative = workbook.addWorksheet("26-27");
    creative.addRows([["Category", "Status", "Description", "Price Per Unit", "Quantity", "Total Budgeted", "Total Spent"], ["Equipment Expense", "Purchased", "Creative camera", 100, 1, 100, 100]]);
    const football = workbook.addWorksheet("FB 26-27");
    football.addRows([["Expense Category", "Description", "Price Per Unit", "Quantity", "Total Budgeted"], ["Services", "Shoot Budget", 20000, 1, 20000]]);
    const buffer = await workbook.xlsx.writeBuffer();
    const form = new FormData();
    form.set("file", new File([buffer], "budget.xlsx"));
    const res = await previewImport(new Request(`${ORIGIN}/api/budget/budget-2/import`, { method: "POST", headers: { origin: ORIGIN }, body: form }), idContext);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sheet).toBe("FB 26-27");
    expect(data.sheets).toEqual([
      { name: "27-28", usable: false },
      { name: "26-27", usable: true },
      { name: "FB 26-27", usable: true },
    ]);
    expect(data.candidates.map((c: { description: string }) => c.description)).toEqual(["Shoot Budget"]);

    form.set("sheet", "26-27");
    const other = await previewImport(new Request(`${ORIGIN}/api/budget/budget-2/import`, { method: "POST", headers: { origin: ORIGIN }, body: form }), idContext);
    expect((await other.json()).data.candidates.map((c: { description: string }) => c.description)).toEqual(["Creative camera"]);
  });

  it("keeps two lines that share a name instead of folding them into one", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.budget!.findUnique!.mockResolvedValue({ id: "budget-1" });
    tx.budgetLine!.findMany!.mockResolvedValue([]);
    tx.budgetLine!.create!.mockResolvedValue({ id: "line-x" });
    const base = { category: "MATERIALS_SUPPLIES", status: "PURCHASED", supplier: null, unitCostCents: 100, quantity: 1, spentCents: 100, purchasedOn: null, poNumber: null, orderNumber: null, unplanned: false, description: "SD card" };
    const res = await commitImport(json("PUT", "/api/budget/budget-1/import", { lines: [base, base] }), idContext);
    expect((await res.json()).data).toEqual({ created: 2, updated: 0 });
    expect(tx.budgetLine!.update!).not.toHaveBeenCalled();
  });

  it("rejects other file types and keeps import admin only", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    expect((await previewImport(upload("x", "notes.txt"), idContext)).status).toBe(400);
    (requireAuth as unknown as MockFn).mockResolvedValue(staff);
    expect((await previewImport(upload("x"), idContext)).status).toBe(403);
  });

  it("updates lines it already made instead of duplicating them", async () => {
    (requireAuth as unknown as MockFn).mockResolvedValue(admin);
    tx.budget!.findUnique!.mockResolvedValue({ id: "budget-1" });
    tx.budgetLine!.findMany!.mockResolvedValue([{ id: "line-1", description: "Sony FX3" }]);
    tx.budgetLine!.create!.mockResolvedValue({ id: "line-2" });
    const base = { category: "EQUIPMENT", status: "PURCHASED", supplier: null, unitCostCents: 100, quantity: 1, spentCents: 100, purchasedOn: null, poNumber: null, orderNumber: null, unplanned: false };
    const res = await commitImport(
      json("PUT", "/api/budget/budget-1/import", { lines: [{ ...base, description: "sony fx3" }, { ...base, description: "Dell laptop" }] }),
      idContext,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ created: 1, updated: 1 });
    expect(tx.budgetLine!.update!).toHaveBeenCalledTimes(1);
    expect(tx.budgetLine!.create!).toHaveBeenCalledTimes(1);
  });
});
