import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  bookingUpdate: vi.fn(),
  assetAllocationUpdateMany: vi.fn(),
  requireEditableCheckout: vi.fn(),
  createAuditEntry: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

const tx = {
  user: { findFirst: mocks.userFindFirst },
  booking: { update: mocks.bookingUpdate },
  assetAllocation: { updateMany: mocks.assetAllocationUpdateMany },
};

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: mocks.userFindFirst },
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));
vi.mock("@/lib/api", () => ({
  withKiosk: <P extends Record<string, string>>(
    handler: (req: Request, ctx: { params: P; kiosk: { kioskId: string; locationId: string } }) => Promise<Response>,
  ) => async (req: Request, ctx?: { params: Promise<P> }) => {
    try {
      return await handler(req, { params: ctx ? await ctx.params : ({} as P), kiosk: { kioskId: "kiosk-1", locationId: "loc-1" } });
    } catch (error) {
      const { fail } = await import("@/lib/http");
      return fail(error);
    }
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry, createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/services/kiosk-active-checkout-items", () => ({
  requireEditableCheckout: mocks.requireEditableCheckout,
  addScannedItemToActiveCheckout: vi.fn(),
  removeActiveCheckoutItem: vi.fn(),
}));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: vi.fn() }));
vi.mock("@/lib/services/live-activities", () => ({
  updateCheckoutReturnLiveActivities: vi.fn(),
  endCheckoutReturnLiveActivities: vi.fn(),
}));

vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters-long");

import { POST as verifyStaff } from "@/app/api/kiosk/staff/verify/route";
import { PATCH as updateCheckout } from "@/app/api/kiosk/checkout/[id]/route";
import { issueKioskStaffToken, verifyKioskStaffToken } from "@/lib/kiosk-staff-token";

const ORIGIN = "http://localhost";
const startsAt = new Date(Date.now() - 60 * 60_000);
const endsAt = new Date(Date.now() + 2 * 60 * 60_000);

function verifyRequest(scanValue: string) {
  return new Request(`${ORIGIN}/api/kiosk/staff/verify`, { method: "POST", body: JSON.stringify({ scanValue }) });
}

function patchRequest(actorId: string, staffToken?: string) {
  return new Request(`${ORIGIN}/api/kiosk/checkout/co-1`, {
    method: "PATCH",
    headers: staffToken ? { "X-Kiosk-Staff-Token": staffToken } : {},
    body: JSON.stringify({ actorId, title: "Soccer at Iowa" }),
  });
}

const ctx = { params: Promise.resolve({ id: "co-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEditableCheckout.mockResolvedValue({
    id: "co-1", title: "Soccer", startsAt, endsAt, custodyScope: "PERSON", requesterUserId: "owner-1",
  });
  mocks.bookingUpdate.mockResolvedValue({ id: "co-1", title: "Soccer at Iowa", endsAt });
});

describe("POST /api/kiosk/staff/verify", () => {
  it("refuses a card that isn't a staff card, and records the attempt", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "student-1", name: "Bucky", avatarUrl: null, role: "STUDENT" });
    const res = await verifyStaff(verifyRequest("9012345678"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ success: false, error: "That card isn't a staff card." });
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "kiosk_staff_verify_refused", entityId: "student-1" }));
  });

  it("refuses a card that matches no one", async () => {
    mocks.userFindFirst.mockResolvedValueOnce(null);
    const res = await verifyStaff(verifyRequest("9012345678"), { params: Promise.resolve({}) });
    expect((await res.json()).success).toBe(false);
    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
  });

  it("returns the staff person and a token bound to them and this kiosk", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "staff-1", name: "Erik Role", avatarUrl: null, role: "STAFF" });
    const res = await verifyStaff(verifyRequest("9012345678"), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user).toMatchObject({ id: "staff-1", role: "STAFF" });
    expect(() => verifyKioskStaffToken(body.data.staffToken, { actorId: "staff-1", kioskId: "kiosk-1" })).not.toThrow();
    expect(() => verifyKioskStaffToken(body.data.staffToken, { actorId: "staff-1", kioskId: "kiosk-2" })).toThrow();
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "kiosk_staff_verified", actorId: "staff-1" }));
  });
});

describe("PATCH /api/kiosk/checkout/[id] staff proof", () => {
  it("lets the holder change their own checkout without a staff scan", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "owner-1", role: "STUDENT" });
    const res = await updateCheckout(patchRequest("owner-1"), ctx);
    expect(res.status).toBe(200);
  });

  it("allows staff on someone else's checkout with a valid staff token", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "staff-1", role: "STAFF" });
    const { token } = issueKioskStaffToken({ userId: "staff-1", kioskId: "kiosk-1" });
    const res = await updateCheckout(patchRequest("staff-1", token), ctx);
    expect(res.status).toBe(200);
    expect(mocks.createAuditEntryTx.mock.calls[0]![1].after).toMatchObject({ staffCardVerified: true });
  });

  it.each([
    ["missing", undefined],
    ["expired", issueKioskStaffToken({ userId: "staff-1", kioskId: "kiosk-1", now: Date.now() - 11 * 60_000 }).token],
    ["another person's", issueKioskStaffToken({ userId: "staff-2", kioskId: "kiosk-1" }).token],
    ["another kiosk's", issueKioskStaffToken({ userId: "staff-1", kioskId: "kiosk-2" }).token],
    ["tampered", `${issueKioskStaffToken({ userId: "staff-1", kioskId: "kiosk-1" }).token}x`],
  ])("refuses staff on someone else's checkout with a %s token", async (_label, token) => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "staff-1", role: "STAFF" });
    const res = await updateCheckout(patchRequest("staff-1", token), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/staff ID card/);
    expect(mocks.bookingUpdate).not.toHaveBeenCalled();
  });
});
