import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
const { pending } = vi.hoisted(() => ({ pending: [] as Array<() => Promise<void>> }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: vi.fn((fn: () => Promise<void>) => pending.push(fn)),
}));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/services/bookings", () => ({ getBookingDetail: vi.fn(), updateBookingItemHolder: vi.fn() }));
vi.mock("@/lib/services/booking-rules", () => ({ getAllowedBookingActions: vi.fn(() => ["manage-custody"]) }));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: vi.fn() }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { BOOKING_SNAPSHOT_HEADER } from "@/lib/booking-concurrency";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { getBookingDetail, updateBookingItemHolder } from "@/lib/services/bookings";
import { POST } from "@/app/api/bookings/[id]/serialized-items/[itemId]/holder/route";

const bookingId = "cm000000000000000000000001";
const itemId = "cm000000000000000000000002";
const targetUserId = "cm000000000000000000000003";
const staffUser = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF, avatarUrl: null };
const transfer = { sourceBookingId: bookingId, targetBookingId: "destination", targetRefNumber: "CO-0011", targetUserName: "Recipient", endsAt: new Date("2026-09-08T15:00:00Z"), sourceClosed: true };
const refreshed = { id: bookingId, kind: "CHECKOUT", status: "CANCELLED", updatedAt: new Date(), serializedItems: [] };
function request(target: string | null = targetUserId, snapshot = "2026-09-07T15:00:00.500Z") {
  return new Request(`https://app.example.com/api/bookings/${bookingId}/serialized-items/${itemId}/holder`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://app.example.com", [BOOKING_SNAPSHOT_HEADER]: snapshot },
    body: JSON.stringify({ targetUserId: target }),
  });
}
const params = { params: Promise.resolve({ id: bookingId, itemId }) };
beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(getBookingDetail).mockResolvedValue(refreshed as never);
  vi.mocked(updateBookingItemHolder).mockResolvedValue(transfer);
});

describe("item custody transfer route", () => {
  it("enforces custody permission, returns refreshed source and links the receiving checkout", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(Role.STAFF, "checkout", "manage_custody");
    expect(updateBookingItemHolder).toHaveBeenCalledWith(expect.objectContaining({ bookingId, serializedItemId: itemId, actorUserId: staffUser.id, targetUserId, expectedUpdatedAt: new Date("2026-09-07T15:00:00.500Z") }));
    await expect(response.json()).resolves.toMatchObject({ data: { serializedItems: [], status: "CANCELLED" }, transfer: { targetBookingId: "destination" } });
    expect(scheduleCheckoutReturnLiveActivity).not.toHaveBeenCalled();
    await pending[0]!();
    expect(scheduleCheckoutReturnLiveActivity).toHaveBeenCalledWith({ bookingId: "destination", endsAt: transfer.endsAt });
    expect(endCheckoutReturnLiveActivities).toHaveBeenCalledWith(bookingId);
  });
  it("never treats a stale legacy holder label as a successful transfer", async () => {
    vi.mocked(updateBookingItemHolder).mockRejectedValue(new HttpError(409, "Refresh"));
    const response = await POST(request(), params);
    expect(response.status).toBe(409);
    expect(pending).toHaveLength(0);
  });
  it("rejects null owners at the boundary", async () => {
    expect((await POST(request(null), params)).status).toBe(400);
    expect(updateBookingItemHolder).not.toHaveBeenCalled();
  });
  it("requires an exact source snapshot", async () => {
    const req = request(); req.headers.delete(BOOKING_SNAPSHOT_HEADER);
    expect((await POST(req, params)).status).toBe(428);
    expect(updateBookingItemHolder).not.toHaveBeenCalled();
  });
  it("does not end reminders for remaining source gear", async () => {
    vi.mocked(updateBookingItemHolder).mockResolvedValue({ ...transfer, sourceClosed: false });
    expect((await POST(request(), params)).status).toBe(200);
    await pending[0]!();
    expect(endCheckoutReturnLiveActivities).not.toHaveBeenCalled();
  });
  it("delivery failure cannot turn a committed transfer into an error response", async () => {
    vi.mocked(endCheckoutReturnLiveActivities).mockRejectedValue(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request(), params);
    await expect(pending[0]!()).resolves.toBeUndefined();
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
