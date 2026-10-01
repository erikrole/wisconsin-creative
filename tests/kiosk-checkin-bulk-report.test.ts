import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkinReportSchema } from "@/lib/validation";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  reportFindUnique: vi.fn(),
  reportUpsert: vi.fn(),
  allocationFindFirst: vi.fn(),
  allocationUpdate: vi.fn(),
  unitUpdate: vi.fn(),
  bulkItemFindUnique: vi.fn(),
  bulkItemUpdate: vi.fn(),
  scanEventCreate: vi.fn(),
  txBookingFindUnique: vi.fn(),
  transaction: vi.fn(),
  createAuditEntryTx: vi.fn(),
  notifyItemReport: vi.fn(),
  maybeAutoComplete: vi.fn(),
  reportedLost: vi.fn(),
  upsertLedger: vi.fn(),
}));

const tx = {
  bookingBulkUnitAllocation: { findFirst: mocks.allocationFindFirst, update: mocks.allocationUpdate },
  bulkSkuUnit: { update: mocks.unitUpdate },
  checkinItemReport: { findUnique: mocks.reportFindUnique, upsert: mocks.reportUpsert },
  bookingBulkItem: { findUnique: mocks.bulkItemFindUnique, update: mocks.bulkItemUpdate },
  scanEvent: { create: mocks.scanEventCreate },
  booking: { findUnique: mocks.txBookingFindUnique },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    checkinItemReport: { findUnique: mocks.reportFindUnique },
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" } }),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn(), createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/notifications", () => ({ notifyItemReport: mocks.notifyItemReport, deferPush: vi.fn() }));
vi.mock("@/lib/services/bookings-checkin", () => ({
  maybeAutoComplete: mocks.maybeAutoComplete,
  wasReturnedOnTime: () => true,
}));
vi.mock("@/lib/services/bookings-helpers", () => ({
  reportedLostBulkBySku: mocks.reportedLost,
  upsertBulkBalancesAndMovements: mocks.upsertLedger,
}));
vi.mock("@/lib/badges", () => ({ badges: { onCheckoutReturned: vi.fn() } }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: vi.fn() }));
vi.mock("@/lib/blob", () => ({
  publicBlobAuth: () => ({ token: "t" }),
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn(() => "jpg"),
}));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));

import { POST } from "@/app/api/kiosk/checkin/[id]/report/route";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function report(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return run(new Request("http://test", { method: "POST", body: form }), { params: Promise.resolve({ id: "co-1" }) });
}

const unit = { id: "unit-7", unitNumber: 7, status: "CHECKED_OUT", notes: null, bulkSku: { id: "sku-batt", name: "Sony Battery", imageUrl: null } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  mocks.userFindFirst.mockResolvedValue({ id: "returner-1", role: "STUDENT" });
  mocks.userFindUnique.mockResolvedValue({ name: "Bucky Badger" });
  mocks.bookingFindUnique.mockResolvedValue({
    id: "co-1", kind: "CHECKOUT", status: "OPEN", title: "Soccer at Iowa",
    requesterUserId: "owner-1", custodyScope: "PERSON", locationId: "loc-1", endsAt: new Date(Date.now() + 3_600_000),
  });
  mocks.txBookingFindUnique.mockResolvedValue({ status: "OPEN" });
  mocks.reportFindUnique.mockResolvedValue(null);
  mocks.reportUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: "rep-1", ...create }));
  mocks.maybeAutoComplete.mockResolvedValue(null);
  mocks.notifyItemReport.mockResolvedValue(undefined);
  mocks.reportedLost.mockResolvedValue(new Map());
});

describe("check-in report targets", () => {
  it("accepts exactly one target, and a quantity only for counted stock", () => {
    expect(checkinReportSchema.safeParse({ type: "LOST" }).success).toBe(false);
    expect(checkinReportSchema.safeParse({ type: "LOST", assetId: "a", bulkSkuUnitId: "u" }).success).toBe(false);
    expect(checkinReportSchema.safeParse({ type: "LOST", bulkSkuId: "s" }).success).toBe(false);
    expect(checkinReportSchema.safeParse({ type: "LOST", assetId: "a", quantity: 2 }).success).toBe(false);
    expect(checkinReportSchema.safeParse({ type: "LOST", bulkSkuId: "s", quantity: "2" }).success).toBe(true);
    expect(checkinReportSchema.safeParse({ type: "DAMAGED", bulkSkuUnitId: "u" }).success).toBe(true);
  });
});

describe("POST /api/kiosk/checkin/[id]/report for batteries", () => {
  it("marks a missing battery unit LOST, closes its custody, and lets the return finish", async () => {
    mocks.allocationFindFirst.mockResolvedValue({ id: "alloc-1", checkedInAt: null, bulkSkuUnit: unit });
    mocks.maybeAutoComplete.mockResolvedValue(new Date());
    const res = await report({ actorId: "returner-1", bulkSkuUnitId: "unit-7", type: "LOST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      type: "LOST", completed: true, heldForStaff: false,
      item: { id: "unit-7", assetTag: "#7", name: "Sony Battery #7" },
    });
    expect(mocks.unitUpdate).toHaveBeenCalledWith({ where: { id: "unit-7" }, data: expect.objectContaining({ status: "LOST" }) });
    expect(mocks.allocationUpdate).toHaveBeenCalledWith({ where: { id: "alloc-1" }, data: { checkedInAt: expect.any(Date) } });
    expect(mocks.reportUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId_bulkSkuUnitId: { bookingId: "co-1", bulkSkuUnitId: "unit-7" } },
    }));
    const unitAudit = mocks.createAuditEntryTx.mock.calls.find((call) => call[1].action === "checkin_report_unit_lost")![1];
    expect(unitAudit.before).toEqual({ status: "CHECKED_OUT", checkedInAt: null });
    expect(unitAudit.after).toMatchObject({ status: "LOST", source: "KIOSK" });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.upsertLedger).not.toHaveBeenCalled();
  });

  it("refuses missing for a battery already scanned back (re-read inside the transaction)", async () => {
    mocks.allocationFindFirst.mockResolvedValue({ id: "alloc-1", checkedInAt: new Date(), bulkSkuUnit: unit });
    await expect(report({ actorId: "returner-1", bulkSkuUnitId: "unit-7", type: "LOST" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.unitUpdate).not.toHaveBeenCalled();
    expect(mocks.reportUpsert).not.toHaveBeenCalled();
  });

  it("refuses damage on a battery that was not scanned back", async () => {
    mocks.allocationFindFirst.mockResolvedValue({ id: "alloc-1", checkedInAt: null, bulkSkuUnit: unit });
    await expect(report({ actorId: "returner-1", bulkSkuUnitId: "unit-7", type: "DAMAGED" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.reportUpsert).not.toHaveBeenCalled();
  });

  it("flags a scanned-back damaged battery for staff without changing its status", async () => {
    mocks.allocationFindFirst.mockResolvedValue({ id: "alloc-1", checkedInAt: new Date(), bulkSkuUnit: { ...unit, status: "AVAILABLE" } });
    const body = await (await report({ actorId: "returner-1", bulkSkuUnitId: "unit-7", type: "DAMAGED", description: "Swollen" })).json();
    expect(body).toMatchObject({ type: "DAMAGED", heldForStaff: true });
    expect(mocks.unitUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyItemReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: "DAMAGED", assetTag: "#7" }));
  });
});

describe("POST /api/kiosk/checkin/[id]/report for counted stock", () => {
  const tape = { id: "bbi-1", bulkSkuId: "sku-tape", checkedOutQuantity: 5, checkedInQuantity: 1, bulkSku: { id: "sku-tape", name: "Gaff tape", imageUrl: null, trackByNumber: false, binQrCodeValue: "BIN-TAPE" } };

  it("reduces what is owed for a missing quantity without restocking it", async () => {
    mocks.bulkItemFindUnique.mockResolvedValue(tape);
    const body = await (await report({ actorId: "returner-1", bulkSkuId: "sku-tape", quantity: "2", type: "LOST" })).json();
    expect(body).toMatchObject({ type: "LOST", quantity: 2, item: { assetTag: "x2" } });
    expect(mocks.upsertLedger).not.toHaveBeenCalled();
    expect(mocks.bulkItemUpdate).not.toHaveBeenCalled();
    const audit = mocks.createAuditEntryTx.mock.calls.find((call) => call[1].action === "checkin_report_bulk_lost")![1];
    expect(audit.before).toEqual({ owed: 4 });
    expect(audit.after).toMatchObject({ owed: 2, quantity: 2 });
    expect(mocks.maybeAutoComplete).toHaveBeenCalled();
  });

  it("refuses more than is still owed after earlier missing reports", async () => {
    mocks.bulkItemFindUnique.mockResolvedValue(tape);
    mocks.reportedLost.mockResolvedValue(new Map([["sku-tape", 3]]));
    await expect(report({ actorId: "returner-1", bulkSkuId: "sku-tape", quantity: "2", type: "LOST" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.reportUpsert).not.toHaveBeenCalled();
  });

  it("returns a damaged quantity through the ledger and flags it for staff", async () => {
    mocks.bulkItemFindUnique.mockResolvedValue(tape);
    const body = await (await report({ actorId: "returner-1", bulkSkuId: "sku-tape", quantity: "1", type: "DAMAGED", description: "Torn" })).json();
    expect(body).toMatchObject({ type: "DAMAGED", heldForStaff: true, quantity: 1 });
    expect(mocks.bulkItemUpdate).toHaveBeenCalledWith({ where: { id: "bbi-1" }, data: { checkedInQuantity: { increment: 1 } } });
    expect(mocks.upsertLedger).toHaveBeenCalledWith(tx, expect.objectContaining({
      kind: "CHECKIN", items: [{ bulkSkuId: "sku-tape", quantity: 1 }], locationId: "loc-1",
    }));
    expect(mocks.scanEventCreate).toHaveBeenCalled();
  });

  it("refuses counted reporting on numbered stock", async () => {
    mocks.bulkItemFindUnique.mockResolvedValue({ ...tape, bulkSku: { ...tape.bulkSku, trackByNumber: true } });
    await expect(report({ actorId: "returner-1", bulkSkuId: "sku-tape", quantity: "1", type: "LOST" })).rejects.toMatchObject({ status: 400 });
  });
});
