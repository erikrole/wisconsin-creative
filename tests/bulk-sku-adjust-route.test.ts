import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mockTx = {
  bulkSku: {
    findUnique: vi.fn(),
  },
  bulkStockBalance: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  bulkStockMovement: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { POST as adjustBulkSku } from "@/app/api/bulk-skus/[id]/adjust/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

function authedPost(path: string, body?: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  mockTx.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", locationId: "loc-1" });
  mockTx.bulkStockBalance.findUnique.mockResolvedValue({ onHandQuantity: 10 });
  mockTx.bulkStockBalance.upsert.mockResolvedValue({});
  mockTx.bulkStockMovement.create.mockResolvedValue({});
});

describe("bulk SKU adjust route", () => {
  it("rejects bulk stock adjustments above the operational cap", async () => {
    mockTx.bulkStockBalance.findUnique.mockResolvedValue({ onHandQuantity: 999_999 });

    const res = await adjustBulkSku(
      authedPost("/api/bulk-skus/sku-1/adjust", { quantityDelta: 2, reason: "count correction" }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("maximum stock quantity");
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
  });

  it("rejects quantity adjustments for unit-tracked item families", async () => {
    mockTx.bulkSku.findUnique.mockResolvedValue({ id: "sku-1", locationId: "loc-1", trackByNumber: true });

    const res = await adjustBulkSku(
      authedPost("/api/bulk-skus/sku-1/adjust", { quantityDelta: 2, reason: "count correction" }),
      { params: Promise.resolve({ id: "sku-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Add units|unit-tracked/i);
    expect(mockTx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(mockTx.bulkStockMovement.create).not.toHaveBeenCalled();
  });
});
