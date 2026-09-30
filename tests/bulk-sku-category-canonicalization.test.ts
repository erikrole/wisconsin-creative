import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createAuditEntry: vi.fn(),
  txCategoryFindUnique: vi.fn(),
  txLocationFindUnique: vi.fn(),
  txBulkSkuCreate: vi.fn(),
  txBulkStockBalanceCreate: vi.fn(),
  txBulkStockMovementCreate: vi.fn(),
  txBulkSkuUnitCreateMany: vi.fn(),
  txBulkSkuFindUniqueOrThrow: vi.fn(),
  dbTransaction: vi.fn(),
  dbBulkSkuFindUnique: vi.fn(),
  dbBulkSkuUpdate: vi.fn(),
  dbCategoryFindUnique: vi.fn(),
  dbLocationFindUnique: vi.fn(),
  dbDepartmentFindUnique: vi.fn(),
  dbBookingBulkUnitAllocationFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.dbTransaction,
    bulkSku: {
      findUnique: mocks.dbBulkSkuFindUnique,
      update: mocks.dbBulkSkuUpdate,
    },
    category: {
      findUnique: mocks.dbCategoryFindUnique,
    },
    location: {
      findUnique: mocks.dbLocationFindUnique,
    },
    department: {
      findUnique: mocks.dbDepartmentFindUnique,
    },
    bookingBulkUnitAllocation: {
      findMany: mocks.dbBookingBulkUnitAllocationFindMany,
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: mocks.createAuditEntry,
  createAuditEntryTx: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { POST as createBulkSku } from "@/app/api/bulk-skus/route";
import { PATCH as updateBulkSku } from "@/app/api/bulk-skus/[id]/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "ADMIN",
  avatarUrl: null,
  forcePasswordChange: false,
};

const categoryId = "cm000000000000000000000001";

function request(path: string, method: string, body: Record<string, unknown>) {
  return new Request(`https://gear.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      host: "gear.test",
      origin: "https://gear.test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(adminUser);
  mocks.createAuditEntry.mockResolvedValue(undefined);
  mocks.txCategoryFindUnique.mockResolvedValue({ name: "Batteries" });
  mocks.txLocationFindUnique.mockResolvedValue({ id: "cm000000000000000000000002" });
  mocks.txBulkSkuCreate.mockResolvedValue({ id: "sku-1" });
  mocks.txBulkStockBalanceCreate.mockResolvedValue({});
  mocks.txBulkStockMovementCreate.mockResolvedValue({});
  mocks.txBulkSkuUnitCreateMany.mockResolvedValue({});
  mocks.txBulkSkuFindUniqueOrThrow.mockResolvedValue({ id: "sku-1", name: "Sony Battery" });
  mocks.dbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      category: { findUnique: mocks.txCategoryFindUnique },
      location: { findUnique: mocks.txLocationFindUnique },
      bulkSku: {
        create: mocks.txBulkSkuCreate,
        findUniqueOrThrow: mocks.txBulkSkuFindUniqueOrThrow,
      },
      bulkStockBalance: { create: mocks.txBulkStockBalanceCreate },
      bulkStockMovement: { create: mocks.txBulkStockMovementCreate },
      bulkSkuUnit: { createMany: mocks.txBulkSkuUnitCreateMany },
    }),
  );
  mocks.dbBulkSkuFindUnique.mockResolvedValue({
    id: "sku-1",
    name: "Sony Battery",
    category: "general",
    categoryId: null,
  });
  mocks.dbCategoryFindUnique.mockResolvedValue({ name: "Batteries" });
  mocks.dbLocationFindUnique.mockResolvedValue({ id: "cm000000000000000000000002" });
  mocks.dbDepartmentFindUnique.mockResolvedValue({ id: "54a4abe3-2500-4a28-8970-86f671cfffd3" });
  mocks.dbBookingBulkUnitAllocationFindMany.mockResolvedValue([]);
  mocks.dbBulkSkuUpdate.mockResolvedValue({
    id: "sku-1",
    name: "Sony Battery",
    category: "Batteries",
    categoryId,
    trackByNumber: false,
    balances: [{ onHandQuantity: 0 }],
    units: [],
  });
});

describe("BulkSku category canonicalization", () => {
  it("creates item families with category text from categoryId instead of client fallback text", async () => {
    const res = await createBulkSku(
      request("/api/bulk-skus", "POST", {
        name: "Sony Battery",
        category: "general",
        categoryId,
        unit: "each",
        locationId: "cm000000000000000000000002",
        binQrCodeValue: "BAT",
        initialQuantity: 0,
        trackByNumber: false,
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(mocks.txCategoryFindUnique).toHaveBeenCalledWith({
      where: { id: categoryId },
      select: { name: true },
    });
    expect(mocks.txBulkSkuCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        category: "Batteries",
        categoryId,
      }),
    }));
  });

  it("updates item-family category text from the canonical category row", async () => {
    const res = await updateBulkSku(
      request("/api/bulk-skus/sku-1", "PATCH", {
        category: "general",
        categoryId,
      }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.dbCategoryFindUnique).toHaveBeenCalledWith({
      where: { id: categoryId },
      select: { name: true },
    });
    expect(mocks.dbBulkSkuUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sku-1" },
      data: {
        category: "Batteries",
        categoryId,
      },
    }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      before: expect.objectContaining({ category: "general" }),
      after: expect.objectContaining({ category: "Batteries" }),
    }));
  });

  it("accepts UUID department IDs when updating an item family", async () => {
    const departmentId = "54a4abe3-2500-4a28-8970-86f671cfffd3";
    mocks.dbBulkSkuUpdate.mockResolvedValueOnce({
      id: "sku-1",
      name: "Sony Battery",
      category: "Batteries",
      categoryId,
      departmentId,
      trackByNumber: false,
      balances: [{ onHandQuantity: 0 }],
      units: [],
    });

    const res = await updateBulkSku(
      request("/api/bulk-skus/sku-1", "PATCH", {
        departmentId,
      }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.dbBulkSkuUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sku-1" },
      data: { departmentId },
    }));
  });

  it("normalizes purchase links and rejects invalid money values on item families", async () => {
    const linkRes = await updateBulkSku(
      request("/api/bulk-skus/sku-1", "PATCH", {
        purchaseLink: "bhphotovideo.com/c/product/sony-battery",
      }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );

    expect(linkRes.status).toBe(200);
    expect(mocks.dbBulkSkuUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { purchaseLink: "https://bhphotovideo.com/c/product/sony-battery" },
    }));

    const moneyRes = await updateBulkSku(
      request("/api/bulk-skus/sku-1", "PATCH", {
        purchasePrice: 123.456,
      }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );

    expect(moneyRes.status).toBe(400);
  });

  it("returns a clean validation error for missing item-family locations", async () => {
    mocks.dbLocationFindUnique.mockResolvedValueOnce(null);

    const res = await updateBulkSku(
      request("/api/bulk-skus/sku-1", "PATCH", {
        locationId: "cm000000000000000000000404",
      }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe("Location not found");
  });
});
