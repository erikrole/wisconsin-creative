import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  itemFindUnique: vi.fn(),
  scanEventFindFirst: vi.fn(),
  reportFindUnique: vi.fn(),
  reportUpsert: vi.fn(),
  assetFindUnique: vi.fn(),
  assetUpdate: vi.fn(),
  transaction: vi.fn(),
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
  notifyItemReport: vi.fn(),
  deferPush: vi.fn(),
  maybeAutoComplete: vi.fn(),
  put: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

const tx = {
  checkinItemReport: { upsert: mocks.reportUpsert },
  asset: { findUnique: mocks.assetFindUnique, update: mocks.assetUpdate },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    booking: { findUnique: mocks.bookingFindUnique },
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    bookingSerializedItem: { findUnique: mocks.itemFindUnique },
    scanEvent: { findFirst: mocks.scanEventFindFirst },
    checkinItemReport: { findUnique: mocks.reportFindUnique },
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, kiosk: { kioskId: "kiosk-1", locationId: "loc-1", locationName: "Camp Randall" } }),
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry, createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/notifications", () => ({ notifyItemReport: mocks.notifyItemReport, deferPush: mocks.deferPush }));
vi.mock("@/lib/services/bookings-checkin", () => ({ maybeAutoComplete: mocks.maybeAutoComplete }));
vi.mock("@/lib/blob", () => ({
  publicBlobAuth: () => ({ token: "t" }),
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn(() => "jpg"),
}));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

import { POST } from "@/app/api/kiosk/checkin/[id]/report/route";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function report(fields: Record<string, string>, file?: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", file);
  return run(new Request("http://test", { method: "POST", body: form }), { params: Promise.resolve({ id: "co-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  mocks.userFindFirst.mockResolvedValue({ id: "returner-1", role: "STUDENT" });
  mocks.userFindUnique.mockResolvedValue({ name: "Bucky Badger" });
  mocks.bookingFindUnique.mockResolvedValue({
    id: "co-1", kind: "CHECKOUT", status: "OPEN", title: "Soccer at Iowa",
    requesterUserId: "owner-1", custodyScope: "PERSON", locationId: "loc-1",
  });
  mocks.itemFindUnique.mockResolvedValue({ allocationStatus: "active", asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3", name: "FX3 body" } });
  mocks.reportFindUnique.mockResolvedValue(null);
  mocks.reportUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: "rep-1", ...create }));
  mocks.assetFindUnique.mockResolvedValue({ status: "AVAILABLE" });
  mocks.maybeAutoComplete.mockResolvedValue(null);
  mocks.notifyItemReport.mockResolvedValue(undefined);
  mocks.put.mockResolvedValue({ url: "https://blob.example/photo.jpg" });
});

describe("POST /api/kiosk/checkin/[id]/report", () => {
  it("holds a scanned-back damaged item for staff with a photo, and notifies staff", async () => {
    mocks.itemFindUnique.mockResolvedValue({ allocationStatus: "returned", asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3", name: "FX3 body" } });
    mocks.scanEventFindFirst.mockResolvedValue({ id: "scan-1" });
    const res = await report(
      { actorId: "returner-1", assetId: "asset-1", type: "DAMAGED", description: "Cracked LCD" },
      new File(["x"], "photo.jpg", { type: "image/jpeg" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true, reportId: "rep-1", type: "DAMAGED", description: "Cracked LCD",
      imageUrl: "https://blob.example/photo.jpg",
      item: { id: "asset-1", assetTag: "CAM-1", name: "FX3 body" },
      checkoutTitle: "Soccer at Iowa", heldForStaff: true, completed: false,
    });
    expect(mocks.assetUpdate).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: { status: "MAINTENANCE" } });
    const actions = mocks.createAuditEntryTx.mock.calls.map((call) => call[1].action);
    expect(actions).toEqual(["kiosk_damage_held_for_staff", "checkin_report_damaged"]);
    expect(mocks.createAuditEntryTx.mock.calls[0]![1].before).toEqual({ status: "AVAILABLE" });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.notifyItemReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: "DAMAGED", reporterName: "Bucky Badger" }));
    expect(mocks.maybeAutoComplete).not.toHaveBeenCalled();
  });

  it("refuses a damage report for an item that was not scanned back", async () => {
    mocks.scanEventFindFirst.mockResolvedValue(null);
    await expect(report({ actorId: "returner-1", assetId: "asset-1", type: "DAMAGED" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.reportUpsert).not.toHaveBeenCalled();
  });

  it("accounts for a missing item and lets its report finish the return", async () => {
    mocks.maybeAutoComplete.mockResolvedValue(new Date());
    const body = await (await report({ actorId: "returner-1", assetId: "asset-1", type: "LOST" })).json();
    expect(body).toMatchObject({ type: "LOST", heldForStaff: false, completed: true, item: { assetTag: "CAM-1" } });
    expect(mocks.maybeAutoComplete).toHaveBeenCalledWith(tx, "co-1", "loc-1", "returner-1", expect.objectContaining({
      auditAction: "auto_completed_by_kiosk_checkin",
    }));
    expect(mocks.assetUpdate).not.toHaveBeenCalled();
    expect(mocks.notifyItemReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: "LOST" }));
  });

  it("refuses missing for an item already scanned back", async () => {
    mocks.itemFindUnique.mockResolvedValue({ allocationStatus: "returned", asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3", name: null } });
    await expect(report({ actorId: "returner-1", assetId: "asset-1", type: "LOST" })).rejects.toMatchObject({ status: 409 });
  });

  it("requires a roster-eligible reporter", async () => {
    await expect(report({ assetId: "asset-1", type: "LOST" })).rejects.toMatchObject({ status: 400 });
    mocks.userFindFirst.mockResolvedValue(null);
    await expect(report({ actorId: "ghost", assetId: "asset-1", type: "LOST" })).rejects.toMatchObject({ status: 404 });
  });

  it("allows a damage report after the last scan completed the checkout, but not missing", async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      id: "co-1", kind: "CHECKOUT", status: "COMPLETED", title: "Soccer", requesterUserId: "owner-1", custodyScope: "PERSON", locationId: "loc-1",
    });
    mocks.scanEventFindFirst.mockResolvedValue({ id: "scan-1" });
    expect((await report({ actorId: "returner-1", assetId: "asset-1", type: "DAMAGED" })).status).toBe(200);
    await expect(report({ actorId: "returner-1", assetId: "asset-1", type: "LOST" })).rejects.toMatchObject({ status: 404 });
  });
});
