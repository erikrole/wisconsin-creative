import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  submitBulk: vi.fn(),
  onCheckoutReturned: vi.fn(),
  endLiveActivities: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  withAuth: (handler: (req: Request, ctx: unknown) => Promise<Response>) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { params: await ctx.params, user: { id: "staff-1", role: Role.STAFF, name: "Staff One" } }),
}));
vi.mock("@/lib/db", () => ({
  db: { booking: { findUniqueOrThrow: vi.fn(async () => ({ locationId: "loc-1" })) } },
}));
vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(async () => ({
    id: "co-1", kind: "CHECKOUT", status: "OPEN", title: "Soccer at Iowa",
    requesterUserId: "owner-1", custodyScope: "PERSON", endsAt: new Date("2099-01-01T00:00:00Z"),
  })),
}));
vi.mock("@/lib/services/checkin-item-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/checkin-item-reports")>()),
  submitBulkCheckinReport: mocks.submitBulk,
}));
vi.mock("@/lib/badges", () => ({ badges: { onCheckoutReturned: mocks.onCheckoutReturned } }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: mocks.endLiveActivities }));

import { POST } from "@/app/api/checkouts/[id]/checkin-report/route";

const run = POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function report(body: Record<string, unknown>) {
  return run(new Request("http://test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "co-1" }) });
}

const saved = { id: "rep-1", type: "LOST", description: null, imageUrl: null, quantity: 2 };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/checkouts/[id]/checkin-report completion follow-through", () => {
  it("awards the return badge and ends the Live Activity when a missing report finishes the return", async () => {
    const completedAt = new Date("2026-10-01T12:00:00Z");
    mocks.submitBulk.mockResolvedValue({ report: saved, completed: true, completedAt });

    const res = await report({ bulkSkuId: "sku-tape", quantity: 2, type: "LOST" });

    expect(res.status).toBe(200);
    expect(mocks.onCheckoutReturned).toHaveBeenCalledWith({
      userId: "owner-1", bookingId: "co-1", completedAt, wasOnTime: true, sourceKey: "co-1",
    });
    expect(mocks.endLiveActivities).toHaveBeenCalledWith("co-1");
  });

  it("does nothing extra when the checkout is still open", async () => {
    mocks.submitBulk.mockResolvedValue({ report: saved, completed: false, completedAt: null });

    await report({ bulkSkuId: "sku-tape", quantity: 2, type: "LOST" });

    expect(mocks.onCheckoutReturned).not.toHaveBeenCalled();
    expect(mocks.endLiveActivities).not.toHaveBeenCalled();
  });
});
