import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    shiftTrade: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createManyAndReturn: vi.fn() },
  },
  push: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: mocks.push }));

import { notifyEligibleStudentsOfTradePost } from "@/lib/services/trade-post-notifications";

const startsAt = new Date("2026-10-31T16:00:00.000Z");
const endsAt = new Date("2026-10-31T22:00:00.000Z");

function trade(extra: Record<string, unknown> = {}, area = "LIVE_PRODUCTION") {
  return {
    id: "t1",
    status: "OPEN",
    postedByUserId: "poster",
    shiftAssignment: {
      shift: { id: "s1", area, workerType: "ST", startsAt, endsAt, shiftGroup: { event: { id: "e1", summary: "Football vs Iowa" } } },
    },
    ...extra,
  };
}

const student = (id: string, extra: Record<string, unknown> = {}) => ({ id, active: true, role: "STUDENT", staffingType: "ST", primaryArea: "LIVE_PRODUCTION", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.shiftTrade.findUnique.mockResolvedValue(trade());
  mocks.db.user.findMany.mockResolvedValue([student("ada"), student("bo", { staffingType: "FT" })]);
  mocks.db.notification.createManyAndReturn.mockImplementation(async ({ data }) => data.map((row: { userId: string }) => ({ id: `n-${row.userId}`, userId: row.userId })));
  mocks.push.mockResolvedValue(undefined);
});

describe("notifyEligibleStudentsOfTradePost", () => {
  it("tells each eligible student once, in the app and by push", async () => {
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(1);

    const { where } = mocks.db.user.findMany.mock.calls[0]![0];
    expect(JSON.stringify(where)).toContain('"not":"poster"');
    expect(JSON.stringify(where)).toContain('"primaryArea":{"in":["LIVE_PRODUCTION"]}');
    const { data, skipDuplicates } = mocks.db.notification.createManyAndReturn.mock.calls[0]![0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([expect.objectContaining({
      userId: "ada",
      type: "trade_available",
      title: "A shift is up for trade",
      body: "A live production shift at Football vs Iowa was posted to the Trade Board. Claim it if you can take it.",
      channel: "IN_APP",
      dedupeKey: "trade_available_t1_ada",
    })]);
    expect(mocks.push).toHaveBeenCalledWith("ada", expect.objectContaining({
      subtitle: "Football vs Iowa", category: "trade", notificationId: "n-ada", body: "Open it on the Trade Board to claim.",
    }));
  });

  it("asks the shared Photo and Graphics pool together", async () => {
    mocks.db.shiftTrade.findUnique.mockResolvedValue(trade({}, "GRAPHICS"));
    mocks.db.user.findMany.mockResolvedValue([student("ada", { primaryArea: "PHOTO" })]);

    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(1);
    expect(JSON.stringify(mocks.db.user.findMany.mock.calls[0]![0].where)).toContain('"primaryArea":{"in":["PHOTO","GRAPHICS"]}');
    expect(mocks.db.notification.createManyAndReturn.mock.calls[0]![0].data[0].body).toMatch(/^A graphics shift at/);
  });

  it("does nothing for a missing or already-claimed post, or when nobody qualifies", async () => {
    mocks.db.shiftTrade.findUnique.mockResolvedValueOnce(null);
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(0);

    mocks.db.shiftTrade.findUnique.mockResolvedValueOnce(trade({ status: "CLAIMED" }));
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(0);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();

    mocks.db.user.findMany.mockResolvedValue([student("bo", { active: false })]);
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(0);
    expect(mocks.db.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("pushes only to rows actually created, so a retry does not repeat alerts", async () => {
    mocks.db.notification.createManyAndReturn.mockResolvedValue([]);

    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("never throws: a failed push or lookup is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.push.mockRejectedValue(new Error("apns down"));
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(1);

    mocks.db.shiftTrade.findUnique.mockRejectedValue(new Error("db down"));
    expect(await notifyEligibleStudentsOfTradePost("t1")).toBe(0);
    expect(error).toHaveBeenCalledWith("[TRADES] Failed to notify eligible students of a post:", expect.any(Error));
  });
});
