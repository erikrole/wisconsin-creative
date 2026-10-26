import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireKiosk: vi.fn(),
  transfer: vi.fn(),
  readReceipt: vi.fn(),
  rejectOperation: vi.fn(),
  scheduleLive: vi.fn(),
  endLive: vi.fn(),
  afterTasks: [] as Array<() => Promise<unknown>>,
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), requireKiosk: mocks.requireKiosk }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => { mocks.afterTasks.push(task); },
}));
vi.mock("@/lib/services/kiosk-item-transfer", () => ({ transferKioskItems: mocks.transfer }));
vi.mock("@/lib/services/kiosk-operation-receipts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/kiosk-operation-receipts")>()),
  readKioskOperationReceipt: mocks.readReceipt,
  rejectKioskOperation: mocks.rejectOperation,
}));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: mocks.scheduleLive }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: mocks.endLive }));

import { HttpError } from "@/lib/http";
import { POST } from "@/app/api/kiosk/checkout/[id]/transfer/route";

const ctx = routeCtx({ id: "source-co" });
const body = {
  actorId: "maya",
  requestId: "1793304000000:0b6f3c1e-7d2a-4c59-9a8e-2f1d4b6c8e90",
  expectedUpdatedAt: "2026-10-24T20:00:00.000Z",
  targetUserId: "jordan",
  assetIds: ["fx3-2"],
  bulkUnitIds: [],
};
const transfer = (payload: unknown = body, headers: Record<string, string> = {}) => {
  const req = jsonRequest("/api/kiosk/checkout/source-co/transfer", "POST", payload);
  for (const [key, value] of Object.entries(headers)) req.headers.set(key, value);
  return POST(req, ctx);
};

beforeEach(() => {
  mocks.afterTasks.length = 0;
  mocks.requireKiosk.mockResolvedValue({ kioskId: "k1", name: "Video Office", locationId: "cr", locationName: "Camp Randall" });
  mocks.readReceipt.mockResolvedValue(null);
  mocks.rejectOperation.mockResolvedValue(null);
  mocks.transfer.mockResolvedValue({
    targetBookingId: "target-co",
    endsAt: new Date("2026-10-25T02:00:00.000Z"),
    sourceClosed: false,
  });
});

describe("POST /api/kiosk/checkout/[id]/transfer", () => {
  it("hands items to another person under this kiosk and request id", async () => {
    const res = await transfer(body, { "x-kiosk-staff-token": "staff-card" });

    expect(res.status).toBe(200);
    expect(mocks.transfer).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "source-co",
      kioskId: "k1",
      targetUserId: "jordan",
      assetIds: ["fx3-2"],
      expectedUpdatedAt: new Date("2026-10-24T20:00:00.000Z"),
      receipt: expect.objectContaining({ id: expect.stringMatching(/^kiosk-operation:[0-9a-f]{64}$/), actorId: "maya" }),
      staffToken: "staff-card",
    }));
  });

  it("starts the receiving checkout's return live activity and leaves the source alone while it stays open", async () => {
    await transfer();
    await Promise.all(mocks.afterTasks.map((task) => task()));

    expect(mocks.scheduleLive).toHaveBeenCalledWith({ bookingId: "target-co", endsAt: new Date("2026-10-25T02:00:00.000Z") });
    expect(mocks.endLive).not.toHaveBeenCalled();
  });

  it("ends the source checkout's live activity when the transfer emptied it", async () => {
    mocks.transfer.mockResolvedValue({ targetBookingId: "target-co", endsAt: new Date(), sourceClosed: true });

    await transfer();
    await Promise.all(mocks.afterTasks.map((task) => task()));

    expect(mocks.endLive).toHaveBeenCalledWith("source-co");
  });

  it("replays a retried request from its receipt instead of moving items twice", async () => {
    mocks.readReceipt.mockResolvedValue({ targetBookingId: "target-co", replayed: true });

    const res = await transfer();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ targetBookingId: "target-co", replayed: true });
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it("returns the stored outcome when a concurrent retry finished first", async () => {
    mocks.transfer.mockRejectedValue(new HttpError(409, "Checkout changed"));
    mocks.readReceipt.mockResolvedValueOnce(null).mockResolvedValueOnce({ targetBookingId: "target-co" });

    const res = await transfer();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ targetBookingId: "target-co" });
  });

  it("surfaces a real failure when no receipt explains it", async () => {
    mocks.transfer.mockRejectedValue(new HttpError(409, "Checkout changed"));

    const res = await transfer();

    expect(res.status).toBe(409);
    expect(mocks.rejectOperation).toHaveBeenCalledWith({}, expect.objectContaining({ actorId: "maya" }), expect.any(HttpError));
  });

  it.each([
    ["both a receiving checkout and a person", { ...body, targetBookingId: "other-co" }],
    ["neither a receiving checkout nor a person", { ...body, targetUserId: undefined }],
    ["more than 100 items", { ...body, assetIds: Array.from({ length: 101 }, (_, i) => `a${i}`) }],
    ["a too-short reason", { ...body, reason: "no" }],
    ["a malformed request id", { ...body, requestId: "req-1" }],
  ])("rejects a request naming %s", async (_label, payload) => {
    const res = await transfer(payload);

    expect(res.status).toBe(400);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it("requires a kiosk session", async () => {
    mocks.requireKiosk.mockRejectedValue(new HttpError(401, "Kiosk session required"));

    const res = await transfer();

    expect(res.status).toBe(401);
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
});
