import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  serializedFindUnique: vi.fn(),
  findAsset: vi.fn(),
  findUnit: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  requireEditableCheckout: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

const tx = {
  user: { findFirst: mocks.userFindFirst },
  bookingSerializedItem: { findUnique: mocks.serializedFindUnique },
};

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", name: "Camp Randall", locationId: "loc-1", locationName: "Camp Randall" } }),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/kiosk-scan", () => ({ findAssetByScanValue: mocks.findAsset }));
vi.mock("@/lib/services/bulk-unit-scans", () => ({ findBulkUnitByScanValue: mocks.findUnit }));
vi.mock("@/lib/services/kiosk-active-checkout-items", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/kiosk-active-checkout-items")>()),
  addScannedItemToActiveCheckout: mocks.add,
  removeActiveCheckoutItem: mocks.remove,
  requireEditableCheckout: mocks.requireEditableCheckout,
}));

import { POST } from "@/app/api/kiosk/checkout/[id]/swap/route";
import { isSameAssetModel } from "@/lib/services/kiosk-active-checkout-items";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function swap(body: Record<string, unknown>) {
  return run(new Request("http://test", { method: "POST", body: JSON.stringify({ actorId: "owner-1", scanValue: "CAM-2", ...body }) }), {
    params: Promise.resolve({ id: "co-1" }),
  });
}

const booking = {
  id: "co-1", title: "Soccer", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000),
  locationId: "loc-1", requesterUserId: "owner-1", custodyScope: "PERSON",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  mocks.userFindFirst.mockResolvedValue({ id: "owner-1", role: "STUDENT" });
  mocks.requireEditableCheckout.mockResolvedValue(booking);
  mocks.findUnit.mockResolvedValue(null);
  mocks.findAsset.mockResolvedValue({
    id: "asset-2", assetTag: "CAM-2", name: "FX3 body", imageUrl: null, status: "AVAILABLE",
    brand: "Sony", model: "FX3", category: { name: "Camera" },
  });
  mocks.serializedFindUnique.mockResolvedValue({
    allocationStatus: "active", asset: { assetTag: "CAM-1", name: "FX3 body", brand: "sony ", model: "fx3" },
  });
  mocks.remove.mockResolvedValue({ success: true, message: "removed" });
  mocks.add.mockResolvedValue({ success: true, message: "added" });
});

describe("POST /api/kiosk/checkout/[id]/swap", () => {
  it("removes and adds in one serializable transaction and audits the swap", async () => {
    const body = await (await swap({ remove: { assetId: "asset-1" } })).json();
    expect(body).toEqual({
      success: true,
      message: "Swapped CAM-1 for CAM-2",
      removed: { assetId: "asset-1", tagName: "CAM-1" },
      added: { assetId: "asset-2", tagName: "CAM-2", name: "FX3 body" },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.remove).toHaveBeenCalledWith(tx, expect.objectContaining({ target: { assetId: "asset-1" } }));
    expect(mocks.add).toHaveBeenCalledWith(tx, expect.objectContaining({ scanValue: "CAM-2" }));
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.add.mock.invocationCallOrder[0]!);
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "kiosk_checkout_item_swapped" }));
  });

  it("rolls the removal back when the replacement is refused", async () => {
    mocks.add.mockResolvedValue({ success: false, error: "CAM-2 is reserved by Erik from 4:00 PM" });
    const body = await (await swap({ remove: { assetId: "asset-1" } })).json();
    expect(body).toEqual({ success: false, error: "CAM-2 is reserved by Erik from 4:00 PM" });
    // The transaction callback threw, so Prisma rolls back the removal.
    await expect(mocks.transaction.mock.results[0]!.value).rejects.toThrow("CAM-2 is reserved");
    expect(mocks.createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("keeps the overdue guard: a swap on an overdue checkout is refused and nothing changes", async () => {
    mocks.add.mockResolvedValue({ success: false, error: "This checkout is overdue. Update the return time before adding items." });
    const body = await (await swap({ remove: { assetId: "asset-1" } })).json();
    expect(body.success).toBe(false);
    await expect(mocks.transaction.mock.results[0]!.value).rejects.toThrow("overdue");
  });

  it("refuses a different model before writing anything", async () => {
    mocks.serializedFindUnique.mockResolvedValue({
      allocationStatus: "active", asset: { assetTag: "CAM-1", name: "A7S III", brand: "Sony", model: "A7S III" },
    });
    const body = await (await swap({ remove: { assetId: "asset-1" } })).json();
    expect(body).toEqual({ success: false, error: "CAM-2 isn't the same model as CAM-1. Scan another A7S III." });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("swaps numbered units only within the same battery kind", async () => {
    mocks.findAsset.mockResolvedValue(null);
    mocks.findUnit.mockResolvedValue({ id: "unit-14", bulkSkuId: "sku-1", unitNumber: 14, name: "Sony battery #14" });
    const ok = await (await swap({ scanValue: "BAT-14", remove: { bulkSkuId: "sku-1", unitNumber: 12 } })).json();
    expect(ok).toMatchObject({ success: true, message: "Swapped #12 for #14", added: { bulkSkuId: "sku-1", unitNumber: 14 } });

    mocks.findUnit.mockResolvedValue({ id: "unit-3", bulkSkuId: "sku-2", unitNumber: 3, name: "Other #3" });
    const other = await (await swap({ scanValue: "OTHER-3", remove: { bulkSkuId: "sku-1", unitNumber: 12 } })).json();
    expect(other.success).toBe(false);
  });

  it("uses the same editor rule as add and remove", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "other-1", role: "STUDENT" });
    await expect(swap({ actorId: "other-1", remove: { assetId: "asset-1" } })).rejects.toMatchObject({ status: 403 });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("compares models by brand and model, ignoring case and spacing", () => {
    expect(isSameAssetModel({ brand: "Sony", model: "FX3" }, { brand: " sony", model: "fx3 " })).toBe(true);
    expect(isSameAssetModel({ brand: "Sony", model: "FX3" }, { brand: "Sony", model: "FX6" })).toBe(false);
  });
});
