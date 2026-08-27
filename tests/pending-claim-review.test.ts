import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { categoryForScheduleNotificationType } from "@/lib/services/schedule-notification-policy";
import {
  CLAIM_AUTO_APPROVE_LEAD_MS,
  CLAIM_ESCALATE_LEAD_MS,
  claimReviewDeadlines,
} from "@/lib/claim-review-deadlines";

const mocks = vi.hoisted(() => ({
  tradeFindUnique: vi.fn(),
  assignmentFindUnique: vi.fn(),
  approveTrade: vi.fn(),
  approveRequest: vi.fn(),
  escalate: vi.fn(),
  report: vi.fn(),
}));

vi.mock("workflow", () => ({ sleep: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    shiftTrade: { findUnique: mocks.tradeFindUnique },
    shiftAssignment: { findUnique: mocks.assignmentFindUnique },
  },
}));
vi.mock("@/lib/services/shift-trades", () => ({ approveTrade: mocks.approveTrade }));
vi.mock("@/lib/services/shift-assignments", () => ({ approveRequest: mocks.approveRequest }));
vi.mock("@/lib/services/claim-review-notifications", () => ({
  escalatePendingClaim: mocks.escalate,
  reportPendingClaimAutoApproval: mocks.report,
}));

import {
  autoApprovePendingClaimStep,
  escalatePendingClaimStep,
} from "@/workflows/pending-claim-review";

const HOUR = 60 * 60_000;

describe("claim review deadlines", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("uses the standard leads when the shift is far enough out", () => {
    const shiftStart = new Date(now.getTime() + 10 * 24 * HOUR);
    const deadlines = claimReviewDeadlines(shiftStart, now)!;

    expect(deadlines.escalateAt).toEqual(new Date(shiftStart.getTime() - CLAIM_ESCALATE_LEAD_MS));
    expect(deadlines.autoApproveAt).toEqual(new Date(shiftStart.getTime() - CLAIM_AUTO_APPROVE_LEAD_MS));
  });

  it("brings escalation forward but keeps the standard resolve lead inside 48h", () => {
    const shiftStart = new Date(now.getTime() + 44 * HOUR);
    const deadlines = claimReviewDeadlines(shiftStart, now)!;

    // T-48h is already past, so escalation moves forward instead of never firing.
    expect(deadlines.escalateAt.getTime()).toBeGreaterThan(now.getTime());
    expect(deadlines.autoApproveAt).toEqual(new Date(shiftStart.getTime() - CLAIM_AUTO_APPROVE_LEAD_MS));
    expect(deadlines.autoApproveAt.getTime()).toBeGreaterThan(deadlines.escalateAt.getTime());
  });

  it("falls back to the split when the standard leads would collide", () => {
    // At exactly 36h out, T-24h lands on the brought-forward escalation. Reusing
    // it would give staff a zero-length window, so both deadlines get spaced.
    const shiftStart = new Date(now.getTime() + 36 * HOUR);
    const deadlines = claimReviewDeadlines(shiftStart, now)!;

    expect(deadlines.autoApproveAt.getTime()).toBeGreaterThan(deadlines.escalateAt.getTime());
    expect(deadlines.autoApproveAt.getTime()).toBeLessThan(shiftStart.getTime());
  });

  it("still leaves a review window for a claim filed hours before the shift", () => {
    const shiftStart = new Date(now.getTime() + 3 * HOUR);
    const deadlines = claimReviewDeadlines(shiftStart, now)!;

    // Both standard leads are in the past. The claim must still escalate, still
    // resolve, and do both before anyone has to show up.
    expect(deadlines.escalateAt.getTime()).toBeGreaterThan(now.getTime());
    expect(deadlines.autoApproveAt.getTime()).toBeGreaterThan(deadlines.escalateAt.getTime());
    expect(deadlines.autoApproveAt.getTime()).toBeLessThan(shiftStart.getTime());
  });

  it("returns no deadlines once the shift has started", () => {
    expect(claimReviewDeadlines(new Date(now.getTime() - HOUR), now)).toBeNull();
  });
});

describe("pending claim review steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tradeFindUnique.mockResolvedValue({ status: "CLAIMED" });
    mocks.assignmentFindUnique.mockResolvedValue({ status: "REQUESTED" });
  });

  it("escalates a trade claim that is still waiting", async () => {
    await expect(escalatePendingClaimStep("trade", "trade-1")).resolves.toMatchObject({
      status: "escalated",
    });
    expect(mocks.escalate).toHaveBeenCalledWith("trade", "trade-1");
  });

  it("does nothing when staff already resolved the claim", async () => {
    mocks.tradeFindUnique.mockResolvedValue({ status: "COMPLETED" });

    await expect(escalatePendingClaimStep("trade", "trade-1")).resolves.toMatchObject({
      status: "superseded",
    });
    expect(mocks.escalate).not.toHaveBeenCalled();
  });

  it("approves a trade claim left unreviewed at the deadline", async () => {
    await expect(autoApprovePendingClaimStep("trade", "trade-1")).resolves.toMatchObject({
      status: "approved",
    });
    expect(mocks.approveTrade).toHaveBeenCalledWith("trade-1");
    expect(mocks.report).toHaveBeenCalledWith("trade", "trade-1", null);
  });

  it("approves a pickup request left unreviewed at the deadline", async () => {
    await expect(autoApprovePendingClaimStep("request", "assignment-1")).resolves.toMatchObject({
      status: "approved",
    });
    expect(mocks.approveRequest).toHaveBeenCalledWith("assignment-1");
  });

  it("never approves a claim staff already decided", async () => {
    mocks.assignmentFindUnique.mockResolvedValue({ status: "DECLINED" });

    await expect(autoApprovePendingClaimStep("request", "assignment-1")).resolves.toMatchObject({
      status: "superseded",
    });
    expect(mocks.approveRequest).not.toHaveBeenCalled();
  });

  it("leaves a claim for a human when the approval itself is blocked", async () => {
    // A conflict appeared, the slot was refilled, time off was approved. The
    // deadline must not force any of those.
    mocks.approveTrade.mockRejectedValue(new HttpError(409, "User already has a shift during this time"));

    await expect(autoApprovePendingClaimStep("trade", "trade-1")).resolves.toMatchObject({
      status: "blocked",
      error: "User already has a shift during this time",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      "trade",
      "trade-1",
      "User already has a shift during this time",
    );
  });

  it("stays quiet when the claim was resolved between the check and the approval", async () => {
    // Staff decided in the gap, or a second run for a re-claimed post got there
    // first. Reporting "could not be approved" then sends reviewers back to a
    // queue with nothing in it.
    mocks.tradeFindUnique
      .mockResolvedValueOnce({ status: "CLAIMED" })
      .mockResolvedValueOnce({ status: "COMPLETED" });
    mocks.approveTrade.mockRejectedValue(new HttpError(400, "Only claimed trades can be approved"));

    await expect(autoApprovePendingClaimStep("trade", "trade-1")).resolves.toMatchObject({
      status: "superseded",
    });
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected failure instead of silently dropping the claim", async () => {
    mocks.approveTrade.mockRejectedValue(new Error("database is on fire"));

    await expect(autoApprovePendingClaimStep("trade", "trade-1")).rejects.toThrow("database is on fire");
  });
});

describe("claim review notification categories", () => {
  it("maps every claim-review type, so none bypasses preference gating", () => {
    // `sendPushToUser` only checks the category preference when a category is
    // given. An unmapped type therefore delivers to someone who muted it, which
    // is the opposite of the intended default.
    for (const type of [
      "claim_review_escalated",
      "claim_review_blocked",
      "claim_review_auto_approved",
      "shift_request_review",
      "shift_request_pending",
      "trade_review_required",
      "trade_claim_pending",
    ]) {
      expect(categoryForScheduleNotificationType(type)).not.toBeNull();
    }
  });
});
