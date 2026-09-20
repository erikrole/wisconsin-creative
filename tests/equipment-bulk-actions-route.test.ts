import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetStatus, Role } from "@prisma/client";

declare global {
  var __equipmentBulkTransactionOptions: unknown;
}

const mockTx = {
  asset: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  bookingSerializedItem: {
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  assetAllocation: {
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  scanEvent: {
    deleteMany: vi.fn(),
  },
  checkinItemReport: {
    deleteMany: vi.fn(),
  },
  auditLog: {
    createMany: vi.fn(),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
      globalThis.__equipmentBulkTransactionOptions = options;
      return fn(mockTx);
    }),
    asset: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { POST as bulkAssets } from "@/app/api/assets/bulk/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

function assetFindManyResult(rows: Array<Record<string, unknown>>) {
  return rows as unknown as Awaited<ReturnType<typeof db.asset.findMany>>;
}

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__equipmentBulkTransactionOptions = undefined;
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  mockTx.asset.findMany.mockResolvedValue([
    { id: "asset-1", status: "AVAILABLE" },
    { id: "asset-2", status: "MAINTENANCE" },
  ]);
  mockTx.asset.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 1 });
  mockTx.asset.deleteMany.mockResolvedValue({ count: 1 });
  mockTx.bookingSerializedItem.count.mockResolvedValue(0);
  mockTx.bookingSerializedItem.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.assetAllocation.count.mockResolvedValue(0);
  mockTx.assetAllocation.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.scanEvent.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.checkinItemReport.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.auditLog.createMany.mockResolvedValue({ count: 2 });
});

describe("equipment bulk actions route", () => {
  it("runs bulk maintenance toggles inside a Serializable transaction", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue(assetFindManyResult([
      { id: "asset-1", status: AssetStatus.AVAILABLE, locationId: "loc-1", categoryId: "cat-1" },
      { id: "asset-2", status: AssetStatus.MAINTENANCE, locationId: "loc-1", categoryId: "cat-1" },
    ]));

    const res = await bulkAssets(
      post("/api/assets/bulk", {
        ids: ["cm111111111111111111111111", "cm222222222222222222222222"],
        action: "maintenance",
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(globalThis.__equipmentBulkTransactionOptions).toEqual({
      isolationLevel: "Serializable",
    });
    expect(mockTx.asset.updateMany).toHaveBeenCalledTimes(2);
    expect(mockTx.auditLog.createMany).toHaveBeenCalledOnce();
  });

  it("blocks bulk delete when selected assets have booking history", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    vi.mocked(db.asset.findMany).mockResolvedValue(assetFindManyResult([
      { id: "cm111111111111111111111111", status: AssetStatus.AVAILABLE, locationId: "loc-1", categoryId: "cat-1" },
    ]));
    mockTx.bookingSerializedItem.count.mockResolvedValue(1);

    const res = await bulkAssets(
      post("/api/assets/bulk", {
        ids: ["cm111111111111111111111111"],
        action: "delete",
      }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("booking history");
    expect(globalThis.__equipmentBulkTransactionOptions).toEqual({
      isolationLevel: "Serializable",
    });
    expect(mockTx.bookingSerializedItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.assetAllocation.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.asset.deleteMany).not.toHaveBeenCalled();
  });
});
