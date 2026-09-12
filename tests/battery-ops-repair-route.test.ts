import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkUnitStatus, Role } from "@prisma/client";

const tx = {
  bulkSkuUnit: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },
  bulkStockBalance: {
    upsert: vi.fn(),
    groupBy: vi.fn(),
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
    $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntriesTx: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntriesTx } from "@/lib/audit";
import { POST as repairStaleBatteryFlags } from "@/app/api/bulk-skus/batteries/repair-stale/route";

function request(body: Record<string, unknown> = {}) {
  return new Request("https://app.example.com/api/bulk-skus/batteries/repair-stale", {
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
  vi.mocked(requireAuth).mockResolvedValue({
    id: "staff-1",
    name: "Staff One",
    email: "staff@example.com",
    role: Role.STAFF,
    avatarUrl: null,
  });
  tx.bulkSkuUnit.findMany.mockResolvedValue([
    {
      id: "unit-29",
      bulkSkuId: "sku-battery",
      unitNumber: 29,
      status: BulkUnitStatus.CHECKED_OUT,
      bulkSku: {
        id: "sku-battery",
        name: "Sony Battery",
        locationId: "loc-1",
        category: "Batteries",
        categoryRel: { name: "Batteries" },
      },
    },
    {
      id: "unit-cable",
      bulkSkuId: "sku-cable",
      unitNumber: 1,
      status: BulkUnitStatus.CHECKED_OUT,
      bulkSku: {
        id: "sku-cable",
        name: "HDMI Cable",
        locationId: "loc-1",
        category: "Cables",
        categoryRel: { name: "Cables" },
      },
    },
  ]);
  tx.bulkSkuUnit.updateMany.mockResolvedValue({ count: 1 });
  tx.bulkSkuUnit.groupBy.mockResolvedValue([{ bulkSkuId: "sku-battery", _count: { _all: 8 } }]);
  tx.bulkStockBalance.groupBy.mockResolvedValue([{ bulkSkuId: "sku-battery", _sum: { onHandQuantity: 7 } }]);
  vi.mocked(createAuditEntriesTx).mockResolvedValue(undefined);
});

describe("POST /api/bulk-skus/batteries/repair-stale", () => {
  it.each([8, 12])("does not add stock already represented in the ledger (%i available)", async (onHand) => {
    tx.bulkStockBalance.groupBy.mockResolvedValue([{ bulkSkuId: "sku-battery", _sum: { onHandQuantity: onHand } }]);
    const res = await repairStaleBatteryFlags(request({ dryRun: false }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).data.repairedCount).toBe(1);
    expect(tx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.bulkStockMovement.create).not.toHaveBeenCalled();
    expect(createAuditEntriesTx).toHaveBeenCalledWith(tx, [expect.objectContaining({ action: "repair_stale_checked_out" })]);
  });

  it("caps a larger historical deficit at the number of flags repaired", async () => {
    tx.bulkStockBalance.groupBy.mockResolvedValue([]);
    const res = await repairStaleBatteryFlags(request({ dryRun: false }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(tx.bulkStockBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { onHandQuantity: { increment: 1 } } }));
    expect(createAuditEntriesTx).toHaveBeenCalledWith(tx, expect.arrayContaining([expect.objectContaining({
      action: "numbered_unit_balance_reconciled",
      before: { onHandQuantity: 0, availableUnitCount: 8 },
      after: expect.objectContaining({ onHandQuantity: 1, quantityAdded: 1 }),
    })]));
  });

  it("aborts a changed candidate set before any balance or audit writes", async () => {
    tx.bulkSkuUnit.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await repairStaleBatteryFlags(request({ dryRun: false }), { params: Promise.resolve({}) });
    expect(res.status).toBe(409);
    expect(tx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.bulkStockMovement.create).not.toHaveBeenCalled();
    expect(createAuditEntriesTx).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON instead of reporting a successful preview", async () => {
    const req = request();
    const invalid = new Request(req, { body: "{" });
    const res = await repairStaleBatteryFlags(invalid, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(tx.bulkSkuUnit.findMany).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.COLLABORATOR])("rejects repair by %s before inventory reads", async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "student-1", name: "Student", email: "s@example.com", role, avatarUrl: null });
    const res = await repairStaleBatteryFlags(request({ dryRun: false }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(tx.bulkSkuUnit.findMany).not.toHaveBeenCalled();
  });

  it("defaults to dry-run and skips writes for stale checked-out battery unit flags", async () => {
    const res = await repairStaleBatteryFlags(
      request({ reason: "Shelf count confirmed returned batteries" }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(tx.bulkSkuUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: BulkUnitStatus.CHECKED_OUT,
        allocations: {
          none: {
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
        },
      }),
    }));
    expect(tx.bulkSkuUnit.updateMany).not.toHaveBeenCalled();
    expect(tx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.bulkStockMovement.create).not.toHaveBeenCalled();
    expect(createAuditEntriesTx).not.toHaveBeenCalled();
    expect(body.data).toEqual({
      dryRun: true,
      plannedCount: 1,
      repairedCount: 0,
      units: [{
        id: "unit-29",
        skuId: "sku-battery",
        skuName: "Sony Battery",
        unitNumber: 29,
      }],
    });
  });

  it("repairs stale checked-out battery unit flags and writes audit entries when dry-run is disabled", async () => {
    const res = await repairStaleBatteryFlags(
      request({ reason: "Shelf count confirmed returned batteries", dryRun: false }),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(tx.bulkSkuUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: BulkUnitStatus.CHECKED_OUT,
        allocations: {
          none: {
            checkedOutAt: { not: null },
            checkedInAt: null,
          },
        },
      }),
    }));
    expect(tx.bulkSkuUnit.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: ["unit-29"] },
        status: BulkUnitStatus.CHECKED_OUT,
      }),
      data: { status: BulkUnitStatus.AVAILABLE },
    });
    expect(tx.bulkStockBalance.upsert).toHaveBeenCalledWith({
      where: { bulkSkuId_locationId: { bulkSkuId: "sku-battery", locationId: "loc-1" } },
      create: { bulkSkuId: "sku-battery", locationId: "loc-1", onHandQuantity: 1 },
      update: { onHandQuantity: { increment: 1 } },
    });
    expect(tx.bulkStockMovement.create).toHaveBeenCalledWith({
      data: {
        bulkSkuId: "sku-battery",
        locationId: "loc-1",
        actorUserId: "staff-1",
        kind: "ADJUSTMENT",
        quantity: 1,
        reason: "Shelf count confirmed returned batteries",
      },
    });
    expect(createAuditEntriesTx).toHaveBeenCalledWith(tx, expect.arrayContaining([
      expect.objectContaining({
        entityType: "bulk_sku_unit",
        entityId: "sku-battery#29",
        action: "repair_stale_checked_out",
        before: { status: BulkUnitStatus.CHECKED_OUT },
        after: expect.objectContaining({
          status: BulkUnitStatus.AVAILABLE,
          reason: "Shelf count confirmed returned batteries",
        }),
      }),
    ]));
    expect(body.data).toEqual({
      dryRun: false,
      plannedCount: 1,
      repairedCount: 1,
      units: [{
        id: "unit-29",
        skuId: "sku-battery",
        skuName: "Sony Battery",
        unitNumber: 29,
      }],
    });
  });

  it("returns zero and skips writes when no stale battery units exist", async () => {
    tx.bulkSkuUnit.findMany.mockResolvedValueOnce([]);

    const res = await repairStaleBatteryFlags(request(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ dryRun: true, plannedCount: 0, repairedCount: 0, units: [] });
    expect(tx.bulkSkuUnit.updateMany).not.toHaveBeenCalled();
    expect(tx.bulkStockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.bulkStockMovement.create).not.toHaveBeenCalled();
    expect(createAuditEntriesTx).not.toHaveBeenCalled();
  });
});
