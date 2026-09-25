import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFindFirst: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  serializedFindUnique: vi.fn(),
  serializedUpdate: vi.fn(),
  scanFindFirst: vi.fn(),
  scanFindMany: vi.fn(),
  scanUpdate: vi.fn(),
  scanUpdateMany: vi.fn(),
  allocationFindFirst: vi.fn(),
  allocationFindMany: vi.fn(),
  allocationUpdate: vi.fn(),
  assetUpdate: vi.fn(),
  unitAllocationFindFirst: vi.fn(),
  unitAllocationUpdate: vi.fn(),
  unitUpdateMany: vi.fn(),
  bulkItemUpdate: vi.fn(),
  upsertBulk: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

const tx = {
  user: { findFirst: m.userFindFirst },
  booking: { findUnique: m.bookingFindUnique, update: m.bookingUpdate },
  bookingSerializedItem: { findUnique: m.serializedFindUnique, update: m.serializedUpdate },
  scanEvent: { findFirst: m.scanFindFirst, findMany: m.scanFindMany, update: m.scanUpdate, updateMany: m.scanUpdateMany },
  assetAllocation: { findFirst: m.allocationFindFirst, findMany: m.allocationFindMany, update: m.allocationUpdate },
  asset: { update: m.assetUpdate },
  bookingBulkUnitAllocation: { findFirst: m.unitAllocationFindFirst, update: m.unitAllocationUpdate },
  bulkSkuUnit: { updateMany: m.unitUpdateMany },
  bookingBulkItem: { update: m.bulkItemUpdate },
};

vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", name: "Kiosk", locationId: "loc-kiosk", locationName: "Kiosk" } }),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: m.createAuditEntryTx }));
vi.mock("@/lib/services/bookings-helpers", () => ({ upsertBulkBalancesAndMovements: m.upsertBulk }));
vi.mock("@/lib/bulk-unit-qr", () => ({
  parseDerivedBulkUnitQr: (value: string) => {
    const match = /-(\d+)$/.exec(value);
    return match ? { unitNumber: Number(match[1]) } : null;
  },
}));

import { DELETE as unstagePickupScan } from "@/app/api/kiosk/pickup/[id]/scan/route";
import { undoKioskCheckinScan } from "@/lib/services/kiosk-checkin-undo";

const ctx = { params: Promise.resolve({ id: "bk-1" }) };
const del = (body: unknown) => new Request("http://test", { method: "DELETE", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  m.userFindFirst.mockResolvedValue({ id: "owner-1", role: "STUDENT", collaboratorPolicy: null });
  m.allocationFindMany.mockResolvedValue([]);
});

describe("DELETE /api/kiosk/pickup/[id]/scan (serialized undo)", () => {
  beforeEach(() => {
    m.bookingFindUnique.mockResolvedValue({ id: "bk-1", kind: "RESERVATION", status: "BOOKED", custodyScope: "PERSON", requesterUserId: "owner-1" });
    m.serializedFindUnique.mockResolvedValue({ allocationStatus: "active", asset: { assetTag: "CAM-1", name: "FX3" } });
    m.scanUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("clears the staged serialized scan and audits it", async () => {
    const body = await (await (unstagePickupScan as never as (r: Request, c: typeof ctx) => Promise<Response>)(del({ actorId: "owner-1", assetId: "asset-1" }), ctx)).json();
    expect(body).toEqual({ success: true, message: "FX3 scan undone." });
    expect(m.scanUpdateMany).toHaveBeenCalledWith({
      where: { bookingId: "bk-1", assetId: "asset-1", phase: "CHECKOUT", success: true },
      data: { success: false },
    });
    expect(m.createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "kiosk_pickup_scan_removed" }));
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("works for a PENDING_PICKUP checkout too", async () => {
    m.bookingFindUnique.mockResolvedValue({ id: "bk-1", kind: "CHECKOUT", status: "PENDING_PICKUP", custodyScope: "PERSON", requesterUserId: "owner-1" });
    const res = await (unstagePickupScan as never as (r: Request, c: typeof ctx) => Promise<Response>)(del({ actorId: "owner-1", assetId: "asset-1" }), ctx);
    expect(res.status).toBe(200);
  });

  it("uses the pickup-plan actor rule", async () => {
    m.userFindFirst.mockResolvedValue({ id: "other-1", role: "STUDENT", collaboratorPolicy: null });
    await expect((unstagePickupScan as never as (r: Request, c: typeof ctx) => Promise<Response>)(del({ actorId: "other-1", assetId: "asset-1" }), ctx))
      .rejects.toMatchObject({ status: 403 });
    expect(m.scanUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses items already handed over", async () => {
    m.serializedFindUnique.mockResolvedValue({ allocationStatus: "picked_up", asset: { assetTag: "CAM-1", name: null } });
    await expect((unstagePickupScan as never as (r: Request, c: typeof ctx) => Promise<Response>)(del({ actorId: "owner-1", assetId: "asset-1" }), ctx))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("undoKioskCheckinScan", () => {
  const now = new Date("2026-09-25T18:00:00.000Z");
  const kiosk = { kioskId: "kiosk-1", locationId: "loc-kiosk" };

  beforeEach(() => {
    m.bookingFindUnique.mockResolvedValue({ id: "co-1", kind: "CHECKOUT", status: "OPEN", endsAt: new Date("2026-09-25T23:00:00.000Z"), locationId: "loc-1" });
  });

  it("puts a serialized item back out and restores its prior location", async () => {
    m.serializedFindUnique.mockResolvedValue({ id: "bsi-1", allocationStatus: "returned", asset: { assetTag: "CAM-1", name: "FX3" } });
    m.scanFindFirst.mockResolvedValue({ id: "scan-1", actualLocationId: "loc-shelf" });
    m.allocationFindFirst.mockResolvedValue({ id: "alloc-1" });

    const result = await undoKioskCheckinScan({ bookingId: "co-1", actorId: "returner-1", target: { assetId: "asset-1" }, kiosk, now });

    expect(result).toMatchObject({ success: true, item: { id: "asset-1", tagName: "CAM-1" } });
    expect(m.serializedUpdate).toHaveBeenCalledWith({ where: { id: "bsi-1" }, data: { allocationStatus: "active" } });
    expect(m.allocationUpdate).toHaveBeenCalledWith({ where: { id: "alloc-1" }, data: { active: true } });
    expect(m.assetUpdate).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: { locationId: "loc-shelf" } });
    expect(m.scanUpdate).toHaveBeenCalledWith({ where: { id: "scan-1" }, data: { success: false } });
    expect(m.scanFindFirst.mock.calls[0]![0].where.createdAt).toEqual({ gte: new Date("2026-09-25T17:40:00.000Z") });
    expect(m.createAuditEntryTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "kiosk_checkin_scan_undone" }));
  });

  it("keeps the item returned when someone has claimed it again", async () => {
    m.serializedFindUnique.mockResolvedValue({ id: "bsi-1", allocationStatus: "returned", asset: { assetTag: "CAM-1", name: "FX3" } });
    m.scanFindFirst.mockResolvedValue({ id: "scan-1", actualLocationId: "loc-shelf" });
    m.allocationFindFirst.mockResolvedValue({ id: "alloc-1" });
    m.allocationFindMany.mockResolvedValue([{
      assetId: "asset-1", bookingId: "co-9", startsAt: now, endsAt: now,
      booking: { title: "x", kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requester: { name: "Erik" } },
    }]);
    await expect(undoKioskCheckinScan({ bookingId: "co-1", actorId: "returner-1", target: { assetId: "asset-1" }, kiosk, now }))
      .rejects.toMatchObject({ status: 409, data: { code: "claimed_again" } });
    expect(m.serializedUpdate).not.toHaveBeenCalled();
  });

  it("puts a numbered battery back out with a paired ledger movement", async () => {
    m.unitAllocationFindFirst.mockResolvedValue({
      id: "ua-1", checkedInAt: new Date("2026-09-25T17:55:00.000Z"),
      bulkSkuUnit: { id: "unit-12", bulkSku: { id: "sku-1", name: "Sony battery", binQrCodeValue: "BAT", trackByNumber: true } },
      bookingBulkItem: { id: "bbi-1", checkedInQuantity: 1 },
    });
    m.scanFindMany.mockResolvedValue([{ id: "scan-9", scanValue: "BAT-12", actualLocationId: "loc-kiosk" }]);
    m.unitUpdateMany.mockResolvedValue({ count: 1 });

    const result = await undoKioskCheckinScan({ bookingId: "co-1", actorId: "returner-1", target: { bulkSkuId: "sku-1", unitNumber: 12 }, kiosk, now });

    expect(result).toMatchObject({ success: true, item: { unitNumber: 12, bulkSkuId: "sku-1" } });
    expect(m.unitAllocationUpdate).toHaveBeenCalledWith({ where: { id: "ua-1" }, data: { checkedInAt: null } });
    expect(m.bulkItemUpdate).toHaveBeenCalledWith({ where: { id: "bbi-1" }, data: { checkedInQuantity: { decrement: 1 } } });
    expect(m.upsertBulk).toHaveBeenCalledWith(tx, expect.objectContaining({ kind: "CHECKOUT", locationId: "loc-kiosk", items: [{ bulkSkuId: "sku-1", quantity: 1 }] }));
    expect(m.scanUpdate).toHaveBeenCalledWith({ where: { id: "scan-9" }, data: { success: false } });
  });

  it("refuses once the return is finished", async () => {
    m.bookingFindUnique.mockResolvedValue({ id: "co-1", kind: "CHECKOUT", status: "COMPLETED", endsAt: now, locationId: "loc-1" });
    await expect(undoKioskCheckinScan({ bookingId: "co-1", actorId: "returner-1", target: { assetId: "asset-1" }, kiosk, now }))
      .rejects.toMatchObject({ status: 409, data: { code: "return_finished" } });
  });

  it("refuses when there is no recent return scan", async () => {
    m.serializedFindUnique.mockResolvedValue({ id: "bsi-1", allocationStatus: "returned", asset: { assetTag: "CAM-1", name: "FX3" } });
    m.scanFindFirst.mockResolvedValue(null);
    await expect(undoKioskCheckinScan({ bookingId: "co-1", actorId: "returner-1", target: { assetId: "asset-1" }, kiosk, now }))
      .rejects.toMatchObject({ status: 409, data: { code: "nothing_to_undo" } });
  });
});
