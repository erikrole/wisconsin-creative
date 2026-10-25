import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    shiftTrade: { findUnique: vi.fn() },
    shiftAssignment: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createManyAndReturn: vi.fn() },
  },
  push: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: mocks.push }));

import { escalatePendingClaim, reportPendingClaimAutoApproval } from "@/lib/services/claim-review-notifications";

const shift = { area: "VIDEO", shiftGroup: { event: { id: "game", summary: "Football vs Iowa" } } };

function created() {
  return mocks.db.notification.createManyAndReturn.mock.calls[0]?.[0] as {
    data: Array<Record<string, unknown>>;
    skipDuplicates: boolean;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.shiftTrade.findUnique.mockResolvedValue({
    claimedBy: { name: "Grace" },
    shiftAssignment: { id: "assign-1", shiftId: "shift-1", shift },
  });
  mocks.db.shiftAssignment.findUnique.mockResolvedValue({ id: "assign-2", shiftId: "shift-2", user: { name: "Ada" }, shift });
  mocks.db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  mocks.db.notification.createManyAndReturn.mockImplementation(async ({ data }: { data: Array<{ userId: string }> }) =>
    data.map((row, index) => ({ id: `note-${index}`, userId: row.userId })));
  mocks.push.mockResolvedValue(undefined);
});

describe("escalatePendingClaim", () => {
  it("warns every admin that a trade claim will approve itself", async () => {
    await escalatePendingClaim("trade", "trade-1");

    const { data, skipDuplicates } = created();
    expect(skipDuplicates).toBe(true);
    expect(data.map((row) => row.userId)).toEqual(["admin-1", "admin-2"]);
    expect(data[0]).toEqual(expect.objectContaining({
      type: "claim_review_escalated",
      title: "Trade claim still needs review",
      body: "Grace's trade claim for the VIDEO shift at Football vs Iowa is still waiting. It will be approved automatically if nobody reviews it.",
      channel: "IN_APP",
      dedupeKey: "claim_review_escalated_trade-1_admin-1",
    }));
    expect(data[0]?.payload).toEqual(expect.objectContaining({ eventId: "game", tradeId: "trade-1", assignmentId: "assign-1" }));
    expect(mocks.push).toHaveBeenCalledWith("admin-1", expect.objectContaining({
      title: "Trade claim still needs review",
      subtitle: "Football vs Iowa",
      body: "Grace wants the VIDEO shift. It's approved automatically if no one reviews it.",
      notificationId: "note-0",
      apnsCategory: undefined,
    }));
  });

  it("names the requester of a shift request", async () => {
    await escalatePendingClaim("request", "assign-2");

    expect(created().data[0]).toEqual(expect.objectContaining({
      title: "Shift request still needs review",
      body: expect.stringContaining("Ada's shift request"),
    }));
    expect(created().data[0]?.payload).not.toHaveProperty("tradeId");
  });

  it("calls an unnamed trade claimant someone", async () => {
    mocks.db.shiftTrade.findUnique.mockResolvedValue({ claimedBy: null, shiftAssignment: { id: "assign-1", shiftId: "shift-1", shift } });

    await escalatePendingClaim("trade", "trade-1");

    expect(created().data[0]?.body).toMatch(/^Someone's trade claim/);
  });

  it("does nothing for a claim that is gone or with no admins", async () => {
    mocks.db.shiftTrade.findUnique.mockResolvedValueOnce(null);
    await escalatePendingClaim("trade", "trade-1");
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();

    mocks.db.user.findMany.mockResolvedValue([]);
    await escalatePendingClaim("trade", "trade-1");
    expect(mocks.db.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("pushes only to admins who did not already have the alert", async () => {
    mocks.db.notification.createManyAndReturn.mockResolvedValue([{ id: "note-9", userId: "admin-2" }]);

    await escalatePendingClaim("request", "assign-2");

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("admin-2", expect.anything());
  });

  it("logs instead of failing the workflow when saving alerts fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.notification.createManyAndReturn.mockRejectedValue(new Error("db down"));

    await expect(escalatePendingClaim("request", "assign-2")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[NOTIFY] Failed to notify reviewers about claim assign-2:", expect.any(Error));
    consoleError.mockRestore();
  });
});

describe("reportPendingClaimAutoApproval", () => {
  it("tells admins about an automatic approval as an alert with nothing to decide", async () => {
    await reportPendingClaimAutoApproval("request", "assign-2", null);

    expect(created().data[0]).toEqual(expect.objectContaining({
      type: "claim_review_auto_approved",
      title: "Approved automatically",
      body: "Ada's shift request for the VIDEO shift at Football vs Iowa was approved automatically at its review deadline.",
    }));
    expect(mocks.push).toHaveBeenCalledWith("admin-1", expect.objectContaining({ apnsCategory: "GT_ALERT" }));
  });

  it("says why an automatic approval was blocked and leaves it decidable", async () => {
    await reportPendingClaimAutoApproval("trade", "trade-1", "Grace is already on another shift then.");

    expect(created().data[0]).toEqual(expect.objectContaining({
      type: "claim_review_blocked",
      title: "Couldn't approve automatically",
      body: "Grace's trade claim for the VIDEO shift at Football vs Iowa couldn't be approved: Grace is already on another shift then. It still needs a decision.",
    }));
    expect(mocks.push).toHaveBeenCalledWith("admin-1", expect.objectContaining({ apnsCategory: undefined }));
  });

  it("does nothing for a claim that is gone", async () => {
    mocks.db.shiftAssignment.findUnique.mockResolvedValue(null);

    await reportPendingClaimAutoApproval("request", "assign-2", null);

    expect(mocks.db.notification.createManyAndReturn).not.toHaveBeenCalled();
  });
});
