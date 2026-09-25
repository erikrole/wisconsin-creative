import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: vi.fn() },
    liveActivityToken: { updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/env", () => ({ env: {} }));

vi.mock("@/lib/push/apns", () => ({
  endCheckoutReturnLiveActivityTokens: vi.fn(),
  startCheckoutReturnLiveActivityTokens: vi.fn(),
  updateCheckoutReturnLiveActivityTokens: vi.fn(),
}));

import { db } from "@/lib/db";
import { updateCheckoutReturnLiveActivityTokens } from "@/lib/push/apns";
import { sweepOverdueCheckoutReturnLiveActivities } from "@/lib/services/live-activities";

const now = new Date("2026-09-23T15:00:00.000Z");

describe("sweepOverdueCheckoutReturnLiveActivities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateCheckoutReturnLiveActivityTokens).mockImplementation(async (tokens) => ({
      revoked: [],
      accepted: tokens,
      ok: tokens.length,
    }) as never);
  });

  it("updates the activity silently; the overdue push is the only alert", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      {
        id: "b1",
        title: "Camera kit",
        endsAt: new Date(now.getTime() - 60_000),
        liveActivityTokens: [{ token: "aa" }, { token: "bb" }],
      },
    ] as never);

    const result = await sweepOverdueCheckoutReturnLiveActivities({ now });

    const calls = vi.mocked(updateCheckoutReturnLiveActivityTokens).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(["aa", "bb"]);
    // No third argument: no alert rides along with the state update.
    expect(calls[0]?.[2]).toBeUndefined();
    expect(result).toMatchObject({ notified: 2, revoked: 0 });
  });
});
