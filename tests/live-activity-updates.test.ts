import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    booking: { findMany: vi.fn(), findFirst: vi.fn() },
    liveActivityToken: { findMany: vi.fn(), updateMany: vi.fn() },
    liveActivityStartToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  update: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { appTimezone: "America/Chicago" } }));
vi.mock("@/lib/push/apns", () => ({
  endCheckoutReturnLiveActivityTokens: vi.fn(),
  startCheckoutReturnLiveActivityTokens: mocks.start,
  updateCheckoutReturnLiveActivityTokens: mocks.update,
}));

import {
  revokeCheckoutReturnLiveActivityStartTokens,
  startCheckoutReturnLiveActivityForBooking,
  startDueCheckoutReturnLiveActivities,
  sweepOverdueCheckoutReturnLiveActivities,
  updateCheckoutReturnLiveActivities,
} from "@/lib/services/live-activities";

const now = new Date("2026-10-25T14:00:00.000Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.db.liveActivityToken.findMany.mockResolvedValue([{ token: "aa" }, { token: "bb" }]);
  mocks.update.mockResolvedValue({ revoked: [], ok: 2 });
});
afterEach(() => { vi.useRealTimers(); });

describe("updateCheckoutReturnLiveActivities", () => {
  it.each([
    [45, "normal"],
    [30, "warning"],
    [10, "critical"],
    [0, "overdue"],
  ])("marks a return %i minutes out as %s", async (offset, urgency) => {
    await updateCheckoutReturnLiveActivities({ bookingId: "b1", endsAt: minutes(offset) });

    expect(mocks.update).toHaveBeenCalledWith(["aa", "bb"], { endsAt: minutes(offset), nextNeedAt: null, allowsExtend: true, urgency });
  });

  it("ends tokens APNs rejected and skips bookings with no live activity", async () => {
    mocks.update.mockResolvedValue({ revoked: ["bb"], ok: 1 });
    await updateCheckoutReturnLiveActivities({ bookingId: "b1", endsAt: minutes(45) });
    expect(mocks.db.liveActivityToken.updateMany).toHaveBeenCalledWith({ where: { token: { in: ["bb"] } }, data: { endedAt: now } });

    vi.clearAllMocks();
    mocks.db.liveActivityToken.findMany.mockResolvedValue([]);
    await updateCheckoutReturnLiveActivities({ bookingId: "b1", endsAt: minutes(45) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("logs a failure instead of failing the checkout change that triggered it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.update.mockRejectedValue(new Error("apns down"));

    await expect(updateCheckoutReturnLiveActivities({ bookingId: "b1", endsAt: minutes(45) })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[LiveActivity] failed to update checkout return activity", expect.objectContaining({ bookingId: "b1" }));
  });
});

describe("starting and sweeping", () => {
  const booking = {
    id: "b1", title: "Camera kit", endsAt: minutes(20), requesterUserId: "u1",
    requester: { name: "Ada Badger", avatarUrl: null, liveActivityStartTokens: [{ token: "s1" }] },
  };

  it("revokes only this user's open checkout-return start tokens", async () => {
    await revokeCheckoutReturnLiveActivityStartTokens("u1");

    expect(mocks.db.liveActivityStartToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", activity: "checkout_return", revokedAt: null },
      data: { revokedAt: now },
    });
  });

  it("skips a booking that can no longer start, and revokes rejected start tokens", async () => {
    mocks.db.booking.findFirst.mockResolvedValueOnce(null);
    expect(await startCheckoutReturnLiveActivityForBooking({ bookingId: "b1", expectedEndsAt: minutes(20) })).toEqual({ started: 0, revoked: 0, skipped: true });

    mocks.db.booking.findFirst.mockResolvedValueOnce(booking);
    mocks.start.mockResolvedValue({ revoked: ["s1"], ok: 0 });
    expect(await startCheckoutReturnLiveActivityForBooking({ bookingId: "b1", expectedEndsAt: minutes(20) })).toEqual({ started: 0, revoked: 1, skipped: false });
    expect(mocks.start).toHaveBeenCalledWith(["s1"], expect.objectContaining({ requesterInitials: "AB", bookingTitle: "Camera kit" }), expect.objectContaining({ urgency: "warning" }));
    expect(mocks.db.liveActivityStartToken.updateMany).toHaveBeenCalledWith({ where: { token: { in: ["s1"] } }, data: { revokedAt: now } });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("counts a scheduled start that failed without stopping the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.booking.findMany.mockResolvedValue([booking, { ...booking, id: "b2" }]);
    mocks.start.mockRejectedValueOnce(new Error("apns down")).mockResolvedValueOnce({ revoked: ["s1"], ok: 0 });

    expect(await startDueCheckoutReturnLiveActivities({ now })).toEqual({ scanned: 2, started: 0, revoked: 1 });
    expect(error).toHaveBeenCalledWith("[LiveActivity] scheduled start failed", expect.any(Error));
  });

  it("ends rejected overdue tokens and logs a failed sweep update", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.booking.findMany.mockResolvedValue([
      { id: "b1", title: "Kit", endsAt: minutes(-2), liveActivityTokens: [{ token: "aa" }] },
      { id: "b2", title: "Kit", endsAt: minutes(-2), liveActivityTokens: [{ token: "bb" }] },
      { id: "b3", title: "Kit", endsAt: minutes(-2), liveActivityTokens: [] },
    ]);
    mocks.update.mockResolvedValueOnce({ revoked: ["aa"], ok: 0 }).mockRejectedValueOnce(new Error("apns down"));

    expect(await sweepOverdueCheckoutReturnLiveActivities({ now })).toEqual({ scanned: 3, notified: 0, revoked: 1 });
    expect(mocks.db.liveActivityToken.updateMany).toHaveBeenCalledWith({ where: { token: { in: ["aa"] } }, data: { endedAt: now } });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("[LiveActivity] overdue update failed", expect.any(Error));
  });
});
