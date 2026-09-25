import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/badges/evaluator", () => ({
  onCheckoutOpened: vi.fn(async () => {
    throw new Error("checkout evaluator should not run");
  }),
  onCheckoutReturned: vi.fn(async () => {
    throw new Error("return evaluator should not run");
  }),
  onAppOpened: vi.fn(async () => {
    throw new Error("app-open evaluator should not run");
  }),
  onTradeCompleted: vi.fn(async () => {
    throw new Error("trade evaluator should not run");
  }),
  onShiftsWorked: vi.fn(async () => {
    throw new Error("shift evaluator should not run");
  }),
}));

vi.mock("@/lib/observability", () => ({
  captureBadgeError: vi.fn(),
}));

vi.mock("@/lib/badges/queries", () => ({
  listEarnedBadgesSince: vi.fn(),
}));

import { badges, badgesEnabled, earnedBadgesSince } from "@/lib/badges";
import * as evaluator from "@/lib/badges/evaluator";
import { listEarnedBadgesSince } from "@/lib/badges/queries";
import { captureBadgeError } from "@/lib/observability";

describe("badge service feature flag", () => {
  const originalFlag = process.env.BADGES_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BADGES_ENABLED = originalFlag;
  });

  it.each([
    ["onCheckoutOpened", () => badges.onCheckoutOpened({
      userId: "user-1",
      bookingId: "booking-1",
      source: "kiosk_checkout",
      sourceKey: "booking-1",
    })],
    ["onCheckoutReturned", () => badges.onCheckoutReturned({
      userId: "user-1",
      bookingId: "booking-1",
      completedAt: new Date("2026-05-09T18:00:00.000Z"),
      wasOnTime: true,
      sourceKey: "booking-1",
    })],
    ["onAppOpened", () => badges.onAppOpened({
      userId: "user-1",
      occurredAt: new Date("2026-08-10T07:30:00.000Z"),
    })],
    ["onTradeCompleted", () => badges.onTradeCompleted({
      userId: "user-1",
      tradeId: "trade-1",
      sourceKey: "trade-1",
    })],
  ] as const)("%s returns before evaluator work when BADGES_ENABLED is not true", async (handler, call) => {
    process.env.BADGES_ENABLED = "false";

    await call();

    expect(badgesEnabled()).toBe(false);
    expect(evaluator[handler]).not.toHaveBeenCalled();
    expect(captureBadgeError).not.toHaveBeenCalled();
  });

  it("throws evaluator errors in test and development", async () => {
    process.env.BADGES_ENABLED = "true";

    await expect(
      badges.onCheckoutOpened({
        userId: "user-1",
        bookingId: "booking-1",
        source: "kiosk_checkout",
        sourceKey: "booking-1",
      }),
    ).rejects.toThrow("checkout evaluator should not run");

    expect(evaluator.onCheckoutOpened).toHaveBeenCalledTimes(1);
    expect(captureBadgeError).not.toHaveBeenCalled();
  });

  it("does not query recent awards while badges are disabled", async () => {
    process.env.BADGES_ENABLED = "false";

    await expect(earnedBadgesSince("user-1", new Date())).resolves.toEqual([]);
    expect(listEarnedBadgesSince).not.toHaveBeenCalled();
  });

  it("keeps a reward read failure from changing the operational response", async () => {
    process.env.BADGES_ENABLED = "true";
    vi.mocked(listEarnedBadgesSince).mockRejectedValueOnce(new Error("badge read failed"));

    await expect(earnedBadgesSince("user-1", new Date())).resolves.toEqual([]);
    expect(captureBadgeError).toHaveBeenCalledWith(
      expect.any(Error),
      { reader: "earnedBadgesSince", userId: "user-1" },
    );
  });
});
