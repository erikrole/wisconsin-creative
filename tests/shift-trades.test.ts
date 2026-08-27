import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeShiftTrade, makeShiftAssignment, makeShift, makeUser } from "./_helpers/factories";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type ShiftTradesTx = {
  shiftTrade: Record<"findUnique" | "findFirst" | "create" | "update", MockFn>;
  shiftAssignment: Record<"findUnique" | "findFirst" | "create" | "update", MockFn>;
  user: Record<"findUnique", MockFn>;
  auditLog: Record<"create", MockFn>;
};
type ShiftTradesDb = {
  _mockTx: ShiftTradesTx;
  $transaction: MockFn;
  shiftTrade: Record<"findMany" | "count" | "updateMany", MockFn>;
  notification: Record<"createMany", MockFn>;
  user: Record<"findMany", MockFn>;
};

// ─── Transaction tracking ───────────────────────────────────────────────────
const transactionCalls: Array<{ options: unknown }> = [];

// ─── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const mockTx = {
    shiftTrade: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    shiftAssignment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      shiftTrade: {
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      notification: {
        createMany: vi.fn(),
      },
      user: {
        findMany: vi.fn(),
      },
      _mockTx: mockTx,
    },
  };
});

// ─── Mock shift-assignments ─────────────────────────────────────────────────
vi.mock("@/lib/services/shift-assignments", () => ({
  checkTimeConflict: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/shift-trade-emails", () => ({
  sendShiftTradeEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/services/notifications", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/badges", () => ({
  badges: {
    onTradeCompleted: vi.fn().mockResolvedValue(undefined),
  },
}));

import { db } from "@/lib/db";
import { badges } from "@/lib/badges";
import { checkTimeConflict } from "@/lib/services/shift-assignments";
import { sendShiftTradeEmail } from "@/lib/services/shift-trade-emails";
import { sendPushToUser } from "@/lib/services/notifications";
import {
  postTrade,
  claimTrade,
  approveTrade,
  declineTrade,
  cancelTrade,
  expireOpenTrades,
  listTrades,
  withdrawTradeClaim,
} from "@/lib/services/shift-trades";

const mockDb = db as unknown as ShiftTradesDb;
const mockTx = mockDb._mockTx;

beforeEach(() => {
  transactionCalls.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
  mockDb.user.findMany.mockResolvedValue([]);
  mockTx.user.findUnique.mockResolvedValue(makeUser({
    id: "claimer-1",
    role: "STUDENT",
    staffingType: "ST",
    primaryArea: "Field",
    areaAssignments: [],
    active: true,
    availabilityBlocks: [],
  }));
  mockTx.auditLog.create.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// postTrade
// ═════════════════════════════════════════════════════════════════════════════
describe("postTrade", () => {
  it("creates a trade for an owned active assignment", async () => {
    const userId = "user-1";
    const assignment = {
      ...makeShiftAssignment({ userId }),
      shift: { ...makeShift(), shiftGroup: {} },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftTrade.findFirst.mockResolvedValue(null);
    mockTx.shiftTrade.create.mockResolvedValue({ id: "trade-1" });

    await postTrade(assignment.id, { id: userId }, "Need swap");

    expect(mockTx.shiftTrade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiftAssignmentId: assignment.id,
          postedByUserId: userId,
          notes: "Need swap",
        }),
      })
    );
  });

  it("throws 404 when assignment not found", async () => {
    mockTx.shiftAssignment.findUnique.mockResolvedValue(null);
    await expect(postTrade("bad-id", { id: "user-1" })).rejects.toThrow("Assignment not found");
  });

  it("throws 403 when user doesn't own the assignment", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "other-user" }),
      shift: { ...makeShift(), shiftGroup: {} },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow("only trade your own");
  });

  it("refuses to post against a shift group with an unpublished working copy", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "user-1" }),
      shift: {
        ...makeShift(),
        shiftGroup: { workingCopy: { version: 3 } },
      },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow(
      "unpublished Schedule changes",
    );
    expect(mockTx.shiftTrade.create).not.toHaveBeenCalled();
  });

  it("throws 400 for inactive assignment status", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "user-1", status: "SWAPPED" }),
      shift: { ...makeShift(), shiftGroup: {} },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow("Only active assignments");
  });

  it("throws 409 when assignment already has open trade", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "user-1" }),
      shift: { ...makeShift(), shiftGroup: {} },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftTrade.findFirst.mockResolvedValue({ id: "existing-trade" });
    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow("already has an open trade");
  });

  it("throws 400 when the shift has already started", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "user-1" }),
      shift: {
        ...makeShift({
          startsAt: new Date("2026-03-01T11:00:00.000Z"),
          endsAt: new Date("2026-03-01T14:00:00.000Z"),
        }),
        shiftGroup: {},
      },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow("already started");
    expect(mockTx.shiftTrade.create).not.toHaveBeenCalled();
  });

  it("uses the effective assignment call start when deciding if a post is stale", async () => {
    const assignment = {
      ...makeShiftAssignment({
        userId: "user-1",
        callStartsAt: new Date("2026-03-01T11:00:00.000Z"),
        callEndsAt: new Date("2026-03-01T15:00:00.000Z"),
      }),
      shift: {
        ...makeShift({
          startsAt: new Date("2026-03-01T13:00:00.000Z"),
          endsAt: new Date("2026-03-01T16:00:00.000Z"),
        }),
        shiftGroup: {},
      },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(postTrade(assignment.id, { id: "user-1" })).rejects.toThrow("already started");
    expect(mockTx.shiftTrade.create).not.toHaveBeenCalled();
  });

  it("lets staff post a student's shift with the owner as poster of record", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "student-1" }),
      shift: {
        ...makeShift(),
        shiftGroup: { event: { id: "evt-1", summary: "Football Media Day" } },
      },
      user: { id: "student-1", name: "Maddy", role: "STUDENT", staffingType: null },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);
    mockTx.shiftTrade.findFirst.mockResolvedValue(null);
    mockTx.shiftTrade.create.mockResolvedValue({ id: "trade-1", postedByUserId: "student-1" });

    await postTrade(assignment.id, { id: "staff-1", role: "STAFF" });

    expect(mockTx.shiftTrade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ postedByUserId: "student-1" }),
      })
    );
    // The owner must be told their shift went on the Trade Board.
    expect(sendPushToUser).toHaveBeenCalledWith(
      "student-1",
      expect.objectContaining({ title: "Your shift is on the Trade Board" })
    );
  });

  it("blocks staff from posting another staff member's shift", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "staff-2" }),
      shift: {
        ...makeShift(),
        shiftGroup: { event: { id: "evt-1", summary: "Football Media Day" } },
      },
      user: { id: "staff-2", name: "Ben", role: "STAFF", staffingType: null },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(postTrade(assignment.id, { id: "staff-1", role: "ADMIN" }))
      .rejects.toThrow("Only student shifts");
    expect(mockTx.shiftTrade.create).not.toHaveBeenCalled();
  });

  it("still blocks students from posting someone else's shift", async () => {
    const assignment = {
      ...makeShiftAssignment({ userId: "student-2" }),
      shift: {
        ...makeShift(),
        shiftGroup: { event: { id: "evt-1", summary: "Football Media Day" } },
      },
      user: { id: "student-2", name: "Jerry", role: "STUDENT", staffingType: null },
    };
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignment);

    await expect(postTrade(assignment.id, { id: "student-1", role: "STUDENT" }))
      .rejects.toThrow("only trade your own");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// claimTrade
// ═════════════════════════════════════════════════════════════════════════════
describe("claimTrade", () => {
  const shift = makeShift({ area: "Field" });

  function openTrade(overrides: Record<string, unknown> = {}) {
    return {
      ...makeShiftTrade({ postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...shift,
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
      ...overrides,
    };
  }

  /** What `shiftTrade.update` returns once a claim lands: CLAIMED, both
   *  parties loaded, and deliberately no `resolvedAt` — staff resolve it. */
  function claimedTrade(trade: ReturnType<typeof openTrade>) {
    return {
      ...trade,
      claimedByUserId: "claimer-1",
      claimedAt: new Date(),
      status: "CLAIMED",
      postedBy: { id: "poster-1", name: "Avery Poster" },
      claimedBy: { id: "claimer-1", name: "Rowan Claimer" },
    };
  }

  // ── REGRESSION: claimTrade must use SERIALIZABLE to prevent double-claim ──
  it("uses SERIALIZABLE isolation to prevent double-claim", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    await claimTrade(trade.id, "claimer-1");

    expectSerializableIsolation(transactionCalls, 0);
  });

  // ── REGRESSION: a lost serialization race must retry, and must not
  // re-send the notifications buffered by the failed attempt. ──
  it("retries once on a serialization conflict without double-sending notifications", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    // The Neon adapter can surface a serialization abort as the raw 40001
    // driver code rather than Prisma's P2034.
    const transaction = mockDb.$transaction as unknown as MockFn;
    transaction.mockRejectedValueOnce({ code: "40001" });

    await claimTrade(trade.id, "claimer-1");

    expect(transaction).toHaveBeenCalledTimes(2);
    // Two pushes is correct: the poster hears their shift was claimed and the
    // claimer hears they are waiting. The point is that the retry doubled
    // neither — the buffers are cleared before the second attempt.
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
    expect(sendShiftTradeEmail).toHaveBeenCalledTimes(1);
    // A claim completes no trade, so it credits no badge on either side.
    expect(badges.onTradeCompleted).not.toHaveBeenCalled();
  });

  it("keeps email delivery best-effort when push delivery rejects after commit", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error("APNs unavailable"));

    await expect(claimTrade(trade.id, "claimer-1")).resolves.toMatchObject({ status: "CLAIMED" });

    expect(sendShiftTradeEmail).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-conflict failure", async () => {
    const transaction = mockDb.$transaction as unknown as MockFn;
    transaction.mockRejectedValueOnce(new Error("boom"));

    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("boom");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("throws 404 when trade not found", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(null);
    await expect(claimTrade("bad-id", "user-1")).rejects.toThrow("Trade not found");
  });

  it("throws 409 when trade is not OPEN", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade({ status: "COMPLETED" }));
    await expect(claimTrade("trade-1", "user-1")).rejects.toThrow("no longer open");
  });

  it("throws 400 when claiming own trade", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade({ postedByUserId: "user-1" }));
    await expect(claimTrade("trade-1", "user-1")).rejects.toThrow("cannot claim your own");
  });

  it("checks conflicts against the effective assignment call window", async () => {
    const callStartsAt = new Date("2026-04-01T10:00:00.000Z");
    const callEndsAt = new Date("2026-04-01T14:00:00.000Z");
    const trade = openTrade({
      shiftAssignment: {
        ...makeShiftAssignment({ callStartsAt, callEndsAt }),
        shift: {
          ...shift,
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    await claimTrade(trade.id, "claimer-1");

    expect(checkTimeConflict).toHaveBeenCalledWith(
      mockTx, "claimer-1", callStartsAt, callEndsAt
    );
  });

  it("throws 400 when area mismatch", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade());
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Courts", areaAssignments: [] }));
    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("not assigned to this shift's area");
  });

  it("allows a claimant whose secondary area matches the trade", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({
      primaryArea: "Courts",
      areaAssignments: [{ area: "Field", isPrimary: false }],
    }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    await expect(claimTrade(trade.id, "claimer-1")).resolves.toMatchObject({ status: "CLAIMED" });
  });

  it("fails closed when the claimant has no area membership", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade());
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: null, areaAssignments: [] }));

    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("not assigned to this shift's area");
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("throws 400 when the claimant is inactive", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade());
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field", active: false }));
    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("Inactive users cannot claim");
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
  });

  // ── REGRESSION: a stale trade must not double-book the shift ──
  it("throws 409 when the posted assignment is no longer active", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    // Poster was removed from the shift after posting — re-fetch sees DECLINED
    mockTx.shiftAssignment.findUnique.mockResolvedValue({
      ...trade.shiftAssignment,
      status: "DECLINED",
    });

    await expect(claimTrade(trade.id, "claimer-1")).rejects.toThrow(
      "no longer held by the poster"
    );
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
  });

  it("throws 409 when the shift was refilled after the trade was posted", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    // Someone else already holds an active assignment on this shift
    mockTx.shiftAssignment.findFirst.mockResolvedValueOnce({ id: "other-active" });

    await expect(claimTrade(trade.id, "claimer-1")).rejects.toThrow(
      "already has an active assignment"
    );
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects claims blocked by approved time off before assignment changes", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade());
    mockTx.user.findUnique.mockResolvedValue(makeUser({
      primaryArea: "Field",
      availabilityBlocks: [{
        kind: "AD_HOC",
        intent: "TIME_OFF",
        status: "APPROVED",
        date: "2026-04-01",
        startsAt: "02:00",
        endsAt: "12:00",
        label: "Family trip",
      }],
    }));

    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("Approved time off: Family trip");
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("throws 400 when claiming after the shift has started", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade({
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...makeShift({
            area: "Field",
            startsAt: new Date("2026-03-01T11:00:00.000Z"),
            endsAt: new Date("2026-03-01T14:00:00.000Z"),
          }),
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    }));

    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("already started");
    expect(checkTimeConflict).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("rejects claims after the effective call start even if the raw shift start is future", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue(openTrade({
      shiftAssignment: {
        ...makeShiftAssignment({
          callStartsAt: new Date("2026-03-01T11:00:00.000Z"),
          callEndsAt: new Date("2026-03-01T15:00:00.000Z"),
        }),
        shift: {
          ...makeShift({
            area: "Field",
            startsAt: new Date("2026-03-01T13:00:00.000Z"),
            endsAt: new Date("2026-03-01T16:00:00.000Z"),
          }),
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    }));

    await expect(claimTrade("trade-1", "claimer-1")).rejects.toThrow("already started");
    expect(checkTimeConflict).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("holds a claim for staff review instead of swapping", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    await claimTrade(trade.id, "claimer-1");

    // The swap is the approval's job. Claiming must not touch assignments at
    // all: the poster stays on the schedule until staff say otherwise.
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CLAIMED",
          claimedByUserId: "claimer-1",
        }),
      })
    );
    // A claim resolves nothing, so it must not stamp resolvedAt.
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: expect.anything() }),
      })
    );
    // No trade completed, so no badge is earned yet.
    expect(badges.onTradeCompleted).not.toHaveBeenCalled();
  });

  it("tells the poster they are still scheduled until the trade is approved", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));

    await claimTrade(trade.id, "claimer-1");

    // Telling the poster only "claimed" is how someone stops showing up for a
    // shift they still hold, so the consequence has to be in the copy.
    expect(sendShiftTradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "poster-1",
        title: "Your trade was claimed",
        eventSummary: "Wisconsin vs Iowa",
        area: "Field",
        body: expect.stringContaining("still scheduled"),
      })
    );
  });

  it("notifies staff that a claim is waiting on them", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));
    mockDb.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "admin-1" }]);

    await claimTrade(trade.id, "claimer-1");

    // A review queue nobody is told about is a queue that sits.
    expect(sendPushToUser).toHaveBeenCalledWith(
      "staff-1",
      expect.objectContaining({ title: "Trade claim needs review" })
    );
    expect(sendPushToUser).toHaveBeenCalledWith(
      "admin-1",
      expect.objectContaining({ title: "Trade claim needs review" })
    );
  });

  it("looks up reviewers only after the claim commits", async () => {
    const trade = openTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.user.findUnique.mockResolvedValue(makeUser({ primaryArea: "Field" }));
    mockTx.shiftAssignment.findUnique.mockResolvedValue({ ...trade.shiftAssignment });
    mockTx.shiftTrade.update.mockResolvedValue(claimedTrade(trade));
    mockDb.user.findMany.mockResolvedValue([{ id: "staff-1" }]);

    await claimTrade(trade.id, "claimer-1");

    // The reviewer fanout must stay out of the SERIALIZABLE claim transaction:
    // widening its read set is what makes two students racing a trade collide.
    expect(mockTx.user.findUnique).toHaveBeenCalled();
    expect(mockDb.user.findMany).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// approveTrade
// ═════════════════════════════════════════════════════════════════════════════
describe("approveTrade", () => {
  it("executes swap on approved trade", async () => {
    const shift = makeShift({ area: "Field" });
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...shift,
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    };
    const assignmentWithShift = {
      ...trade.shiftAssignment,
      shift,
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftAssignment.findUnique.mockResolvedValue(assignmentWithShift);
    mockTx.shiftAssignment.update.mockResolvedValue({});
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "COMPLETED" });

    await approveTrade(trade.id);

    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
    expect(sendShiftTradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "claimer-1",
        title: "Trade approved",
        eventSummary: "Wisconsin vs Iowa",
        area: "Field",
      })
    );
    expect(sendShiftTradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "poster-1",
        title: "Your trade was approved — you're off the shift",
        body: expect.stringContaining("no longer on the schedule"),
      })
    );
    expect(badges.onTradeCompleted).toHaveBeenCalledWith({
      userId: "poster-1",
      tradeId: trade.id,
      sourceKey: trade.id,
    });
    expect(badges.onTradeCompleted).toHaveBeenCalledWith({
      userId: "claimer-1",
      tradeId: trade.id,
      sourceKey: trade.id,
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: undefined,
        action: "trade_auto_approved",
      }),
    }));
  });

  it("records the reviewing staff actor on human approval", async () => {
    const shift = makeShift({ area: "Field" });
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: { ...shift, shiftGroup: { event: { summary: "Wisconsin vs Iowa" } } },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftAssignment.findUnique.mockResolvedValue(trade.shiftAssignment);
    mockTx.shiftAssignment.create.mockResolvedValue({});
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "COMPLETED" });

    await approveTrade(trade.id, { id: "staff-1", role: "STAFF" });

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: "staff-1", action: "trade_approved" }),
    }));
    expect(mockTx.shiftAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedBy: "staff-1" }),
    }));
  });

  it("revalidates claimant active state, class, and area before approval", async () => {
    const shift = makeShift({ area: "Field" });
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: { ...shift, shiftGroup: { event: { summary: "Wisconsin vs Iowa" } } },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftAssignment.findUnique.mockResolvedValue(trade.shiftAssignment);

    mockTx.user.findUnique.mockResolvedValueOnce(makeUser({
      active: false,
      primaryArea: "Field",
      areaAssignments: [],
    }));
    await expect(approveTrade(trade.id)).rejects.toThrow("Inactive users cannot claim shifts");

    mockTx.user.findUnique.mockResolvedValueOnce(makeUser({
      active: true,
      staffingType: "FT",
      primaryArea: "Field",
      areaAssignments: [],
    }));
    await expect(approveTrade(trade.id)).rejects.toThrow("scheduling class");

    mockTx.user.findUnique.mockResolvedValueOnce(makeUser({
      active: true,
      staffingType: "ST",
      primaryArea: "Courts",
      areaAssignments: [],
    }));
    await expect(approveTrade(trade.id)).rejects.toThrow("not assigned to this shift's area");

    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("fails closed when claimant eligibility cannot be reloaded", async () => {
    const shift = makeShift({ area: "Field" });
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: { ...shift, shiftGroup: { event: { summary: "Wisconsin vs Iowa" } } },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftAssignment.findUnique.mockResolvedValue(trade.shiftAssignment);
    mockTx.user.findUnique.mockRejectedValue(new Error("database unavailable"));

    await expect(approveTrade(trade.id)).rejects.toThrow("database unavailable");
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.shiftAssignment.create).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("throws 400 when trade is not CLAIMED", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue({
      ...makeShiftTrade({ status: "OPEN" }),
      shiftAssignment: { ...makeShiftAssignment(), shift: makeShift() },
    });
    await expect(approveTrade("trade-1")).rejects.toThrow("Only claimed trades");
  });

  it("throws 400 when no claimer", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue({
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: null }),
      shiftAssignment: { ...makeShiftAssignment(), shift: makeShift() },
    });
    await expect(approveTrade("trade-1")).rejects.toThrow("no claimer");
  });

  it("throws 400 when approving after the shift has started", async () => {
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...makeShift({
            startsAt: new Date("2026-03-01T11:00:00.000Z"),
            endsAt: new Date("2026-03-01T14:00:00.000Z"),
          }),
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);

    await expect(approveTrade(trade.id)).rejects.toThrow("already started");
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("rejects approval after the effective call start even if the raw shift start is future", async () => {
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", postedByUserId: "poster-1" }),
      shiftAssignment: {
        ...makeShiftAssignment({
          callStartsAt: new Date("2026-03-01T11:00:00.000Z"),
          callEndsAt: new Date("2026-03-01T15:00:00.000Z"),
        }),
        shift: {
          ...makeShift({
            startsAt: new Date("2026-03-01T13:00:00.000Z"),
            endsAt: new Date("2026-03-01T16:00:00.000Z"),
          }),
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);

    await expect(approveTrade(trade.id)).rejects.toThrow("already started");
    expect(mockTx.shiftAssignment.update).not.toHaveBeenCalled();
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// declineTrade
// ═════════════════════════════════════════════════════════════════════════════
describe("declineTrade", () => {
  it("resets claimed trade back to OPEN", async () => {
    const shift = makeShift({ area: "Field" });
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...shift,
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "OPEN" });

    await declineTrade(trade.id);

    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "OPEN",
          claimedByUserId: null,
          claimedAt: null,
        }),
      })
    );
    expect(sendShiftTradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "claimer-1",
        title: "Trade claim declined",
        eventSummary: "Wisconsin vs Iowa",
        area: "Field",
      })
    );
  });

  it("records the declining staff actor and the claimer it cleared", async () => {
    const claimedAt = new Date("2026-02-27T09:00:00.000Z");
    const trade = {
      ...makeShiftTrade({ status: "CLAIMED", claimedByUserId: "claimer-1", claimedAt }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift: {
          ...makeShift({ area: "Field" }),
          shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
        },
      },
    };
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "OPEN", claimedByUserId: null });

    await declineTrade(trade.id, { id: "staff-9", role: "STAFF" });

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "staff-9",
          entityType: "shift_trade",
          entityId: trade.id,
          action: "trade_declined",
          beforeJson: expect.objectContaining({ claimedByUserId: "claimer-1" }),
          afterJson: expect.objectContaining({
            status: "OPEN",
            claimedByUserId: null,
            _actorRole: "STAFF",
          }),
        }),
      })
    );
  });

  it("throws 400 when trade is not CLAIMED", async () => {
    mockTx.shiftTrade.findUnique.mockResolvedValue({
      ...makeShiftTrade({ status: "OPEN" }),
      shiftAssignment: { ...makeShiftAssignment(), shift: makeShift() },
    });
    await expect(declineTrade("trade-1")).rejects.toThrow("Only claimed trades");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// expireOpenTrades
// ═════════════════════════════════════════════════════════════════════════════
describe("expireOpenTrades", () => {
  function staleTrade(overrides: Record<string, unknown> = {}) {
    return {
      id: "trade-stale",
      postedByUserId: "poster-1",
      claimedByUserId: null,
      shiftAssignment: {
        shift: {
          area: "Field",
          shiftGroup: { event: { id: "event-1", summary: "Wisconsin vs Iowa" } },
        },
      },
      ...overrides,
    };
  }

  it("tells the claimer their claim died with the post, not just the poster", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([
      staleTrade({ claimedByUserId: "claimer-1" }),
    ]);
    mockDb.shiftTrade.updateMany.mockResolvedValue({ count: 1 });
    mockDb.notification.createMany.mockResolvedValue({ count: 2 });

    await expect(expireOpenTrades()).resolves.toEqual({ expired: 1 });

    const rows = mockDb.notification.createMany.mock.calls.at(-1)?.[0]?.data as Array<{
      userId: string;
      type: string;
      dedupeKey: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: "poster-1", type: "trade_expired" });
    expect(rows[1]).toMatchObject({
      userId: "claimer-1",
      type: "trade_claim_expired",
      dedupeKey: "trade_claim_expired_trade-stale",
    });
  });

  it("notifies only the poster when nobody had claimed the post", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([staleTrade()]);
    mockDb.shiftTrade.updateMany.mockResolvedValue({ count: 1 });
    mockDb.notification.createMany.mockResolvedValue({ count: 1 });

    await expireOpenTrades();

    const rows = mockDb.notification.createMany.mock.calls.at(-1)?.[0]?.data as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("does no work when nothing is stale", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([]);

    await expect(expireOpenTrades()).resolves.toEqual({ expired: 0 });
    expect(mockDb.shiftTrade.updateMany).not.toHaveBeenCalled();
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// cancelTrade
// ═════════════════════════════════════════════════════════════════════════════
describe("cancelTrade", () => {
  it("cancels own OPEN trade", async () => {
    const trade = makeShiftTrade({ postedByUserId: "user-1", status: "OPEN" });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "CANCELLED" });

    await cancelTrade(trade.id, { id: "user-1" });

    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });

  it("cancels own CLAIMED trade", async () => {
    const trade = makeShiftTrade({ postedByUserId: "user-1", status: "CLAIMED" });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({ ...trade, status: "CANCELLED" });

    await cancelTrade(trade.id, { id: "user-1" });

    expect(mockTx.shiftTrade.update).toHaveBeenCalled();
  });

  it("throws 403 when cancelling someone else's trade", async () => {
    const trade = makeShiftTrade({ postedByUserId: "other-user", status: "OPEN" });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    await expect(cancelTrade(trade.id, { id: "user-1" })).rejects.toThrow("only cancel your own");
  });

  it("throws 400 when trade is COMPLETED", async () => {
    const trade = makeShiftTrade({ postedByUserId: "user-1", status: "COMPLETED" });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    await expect(cancelTrade(trade.id, { id: "user-1" })).rejects.toThrow("cannot be cancelled");
  });

  it("lets staff remove a student's post and notifies the owner", async () => {
    const trade = makeShiftTrade({ postedByUserId: "student-1", status: "OPEN" });
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({
      ...trade,
      status: "CANCELLED",
      shiftAssignment: {
        id: "assign-1",
        shift: {
          id: "shift-1",
          area: "VIDEO",
          shiftGroup: { event: { id: "evt-1", summary: "Football Media Day" } },
        },
        user: { id: "student-1", name: "Maddy" },
      },
    });

    await cancelTrade(trade.id, { id: "staff-1", role: "STAFF" });

    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
    expect(sendPushToUser).toHaveBeenCalledWith(
      "student-1",
      expect.objectContaining({ title: "Removed from the Trade Board" })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// withdrawTradeClaim
// ═════════════════════════════════════════════════════════════════════════════
describe("withdrawTradeClaim", () => {
  function claimedTrade() {
    const shift = makeShift({ area: "Field" });
    const assignment = {
      ...makeShiftAssignment({ userId: "poster-1" }),
      shift: {
        ...shift,
        shiftGroup: {
          workingCopy: null,
          event: { id: "evt-1", summary: "Wisconsin vs Iowa" },
        },
      },
    };
    return {
      ...makeShiftTrade({
        id: "trade-claim-1",
        status: "CLAIMED",
        postedByUserId: "poster-1",
        claimedByUserId: "claimer-1",
        claimedAt: new Date("2026-03-01T10:00:00.000Z"),
      }),
      shiftAssignment: assignment,
      postedBy: { id: "poster-1", name: "Avery Poster" },
      claimedBy: { id: "claimer-1", name: "Rowan Claimer" },
    };
  }

  it("returns a claimed trade to OPEN and records the withdrawal", async () => {
    const trade = claimedTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);
    mockTx.shiftTrade.update.mockResolvedValue({
      ...trade,
      status: "OPEN",
      claimedByUserId: null,
      claimedAt: null,
    });

    const result = await withdrawTradeClaim(trade.id, { id: "claimer-1", role: "STUDENT" });

    expect(result.status).toBe("OPEN");
    expect(mockTx.shiftTrade.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { claimedByUserId: null, claimedAt: null, status: "OPEN" },
    }));
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "trade_claim_withdrawn" }),
    }));
    expectSerializableIsolation(transactionCalls, 0);
    expect(sendPushToUser).toHaveBeenCalledWith(
      "poster-1",
      expect.objectContaining({ title: "Trade claim withdrawn" }),
    );
    expect(sendShiftTradeEmail).toHaveBeenCalledWith(expect.objectContaining({
      userId: "poster-1",
      title: "Trade claim withdrawn",
    }));
  });

  it("only lets the current claimer withdraw a CLAIMED trade", async () => {
    const trade = claimedTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue(trade);

    await expect(withdrawTradeClaim(trade.id, { id: "other-user", role: "STUDENT" }))
      .rejects.toThrow("only withdraw your own trade claim");
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });

  it("rejects an OPEN trade because there is no pending claim to withdraw", async () => {
    const trade = claimedTrade();
    mockTx.shiftTrade.findUnique.mockResolvedValue({ ...trade, status: "OPEN" });

    await expect(withdrawTradeClaim(trade.id, { id: "claimer-1", role: "STUDENT" }))
      .rejects.toThrow("Only claimed trades can be withdrawn");
    expect(mockTx.shiftTrade.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// listTrades
// ═════════════════════════════════════════════════════════════════════════════
describe("listTrades", () => {
  it("keeps actionable trades ahead of resolved history in the page window", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([]);
    mockDb.shiftTrade.count.mockResolvedValue(0);

    await listTrades({ limit: 100, offset: 0 });

    // Resolved trades accumulate forever. Sorting on recency alone eventually
    // pushes a claim waiting on staff off the end of the page — and out of the
    // review queue that is built from it.
    expect(mockDb.shiftTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ status: "asc" }, { postedAt: "desc" }, { id: "asc" }],
      }),
    );
  });

  it("hides stale open trades from the default board query", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([]);
    mockDb.shiftTrade.count.mockResolvedValue(0);

    await listTrades({ limit: 100, offset: 0 });

    expect(mockDb.shiftTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { status: { notIn: ["OPEN", "CLAIMED"] } },
                { shiftAssignment: expect.objectContaining({
                  OR: expect.arrayContaining([
                    { callStartsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } },
                    { callStartsAt: null, shift: { callStartsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } } },
                    { callStartsAt: null, shift: { callStartsAt: null, startsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } } },
                  ]),
                }) },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("hides stale trades for explicit OPEN queries", async () => {
    mockDb.shiftTrade.findMany.mockResolvedValue([]);
    mockDb.shiftTrade.count.mockResolvedValue(0);

    await listTrades({ status: "OPEN", area: "VIDEO", limit: 100, offset: 0 });

    expect(mockDb.shiftTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "OPEN",
          AND: expect.arrayContaining([
            { shiftAssignment: { shift: { area: "VIDEO" } } },
            { shiftAssignment: expect.objectContaining({
              OR: expect.arrayContaining([
                { callStartsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } },
                { callStartsAt: null, shift: { callStartsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } } },
                { callStartsAt: null, shift: { callStartsAt: null, startsAt: { gt: new Date("2026-03-01T12:00:00.000Z") } } },
              ]),
            }) },
          ]),
        }),
      }),
    );
  });

  it("adds viewer and claimed-by availability context to listed trades", async () => {
    const shift = {
      ...makeShift({
        area: "VIDEO",
        startsAt: new Date("2026-04-01T08:00:00.000Z"),
        endsAt: new Date("2026-04-01T16:00:00.000Z"),
      }),
      shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
    };
    const trade = {
      ...makeShiftTrade({
        id: "trade-1",
        postedByUserId: "poster-1",
        claimedByUserId: "claimer-1",
        status: "CLAIMED",
      }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        callStartsAt: null,
        callEndsAt: null,
        shift,
        user: { id: "poster-1", name: "Poster", primaryArea: "VIDEO" },
      },
      postedBy: { id: "poster-1", name: "Poster" },
      claimedBy: { id: "claimer-1", name: "Claimer" },
    };
    mockDb.shiftTrade.findMany.mockResolvedValue([trade]);
    mockDb.shiftTrade.count.mockResolvedValue(1);
    mockDb.user.findMany.mockResolvedValue([
      {
        id: "viewer-1",
        availabilityBlocks: [{
          kind: "AD_HOC",
          intent: "PREFER",
          status: "APPROVED",
          date: "2026-04-01",
          startsAt: "02:00",
          endsAt: "12:00",
          label: "Video games",
        }],
      },
      {
        id: "claimer-1",
        availabilityBlocks: [{
          kind: "AD_HOC",
          intent: "TIME_OFF",
          status: "APPROVED",
          date: "2026-04-01",
          startsAt: "02:00",
          endsAt: "12:00",
          label: "Family trip",
        }],
      },
    ]);

    const result = await listTrades({ userId: "viewer-1", limit: 100, offset: 0 });

    expect(mockDb.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["viewer-1", "claimer-1"] } },
    }));
    expect(result.data[0]).toEqual(expect.objectContaining({
      viewerAvailabilityContext: expect.objectContaining({
        state: "preferred",
        detail: "Prefers Video games (02:00-12:00)",
      }),
      claimedByAvailabilityContext: expect.objectContaining({
        state: "blocked",
        detail: "Approved time off: Family trip (02:00-12:00)",
      }),
    }));
  });

  it("returns server-owned trade claimability for scheduling class and area", async () => {
    const shift = {
      ...makeShift({ area: "VIDEO" }),
      shiftGroup: { event: { summary: "Wisconsin vs Iowa" } },
    };
    const trade = {
      ...makeShiftTrade({ id: "trade-1", postedByUserId: "poster-1", status: "OPEN" }),
      shiftAssignment: {
        ...makeShiftAssignment(),
        shift,
        user: { id: "poster-1", name: "Poster", primaryArea: "VIDEO" },
      },
      postedBy: { id: "poster-1", name: "Poster" },
      claimedBy: null,
    };
    mockDb.shiftTrade.findMany.mockResolvedValue([trade]);
    mockDb.shiftTrade.count.mockResolvedValue(1);
    mockDb.user.findMany.mockResolvedValue([{
      id: "viewer-1",
      role: "STUDENT",
      staffingType: "ST",
      active: true,
      primaryArea: "PHOTO",
      areaAssignments: [],
      availabilityBlocks: [],
    }]);

    const blocked = await listTrades({ userId: "viewer-1", limit: 100, offset: 0 });

    expect(blocked.data[0]).toEqual(expect.objectContaining({
      viewerCanClaim: false,
      viewerClaimReason: "You are not assigned to this shift's area (VIDEO)",
    }));

    mockDb.user.findMany.mockResolvedValue([{
      id: "viewer-1",
      role: "STAFF",
      staffingType: "ST",
      active: true,
      primaryArea: "VIDEO",
      areaAssignments: [],
      availabilityBlocks: [],
    }]);

    const claimable = await listTrades({ userId: "viewer-1", limit: 100, offset: 0 });
    expect(claimable.data[0]).toEqual(expect.objectContaining({
      viewerCanClaim: true,
      viewerClaimReason: null,
    }));

    mockDb.user.findMany.mockResolvedValue([{
      id: "viewer-1",
      role: "STUDENT",
      staffingType: "ST",
      active: true,
      primaryArea: "PHOTO",
      areaAssignments: [{ area: "VIDEO" }],
      availabilityBlocks: [],
    }]);

    const secondaryArea = await listTrades({ userId: "viewer-1", limit: 100, offset: 0 });
    expect(secondaryArea.data[0]).toEqual(expect.objectContaining({
      viewerCanClaim: true,
      viewerClaimReason: null,
    }));
  });
});
