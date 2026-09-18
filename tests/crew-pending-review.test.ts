import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claimsForWorkingSlot, tradeForWorkingSlot } from "@/lib/crew-pending-review";
import type { WorkingScheduleSlot } from "@/lib/schedule-working-copy";

const eventStartsAt = "2026-10-06T18:00:00.000Z";
const eventEndsAt = "2026-10-06T21:00:00.000Z";

function slot(overrides: Partial<WorkingScheduleSlot> = {}): WorkingScheduleSlot {
  return {
    key: "shift-1",
    sourceShiftId: "shift-1",
    area: "VIDEO",
    workerType: "ST",
    startsAt: eventStartsAt,
    endsAt: eventEndsAt,
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: 0,
    assignment: null,
    ...overrides,
  };
}

describe("inline crew claim review", () => {
  it("shows pending claims only on empty live slots", () => {
    const claims = [{
      id: "claim-1",
      shiftId: "shift-1",
      hasConflict: false,
      conflictNote: null,
      user: { id: "student-1", name: "Alex", avatarUrl: null },
    }];

    expect(claimsForWorkingSlot(slot(), claims)).toHaveLength(1);
    expect(claimsForWorkingSlot(slot({ sourceShiftId: null }), claims)).toEqual([]);
    expect(claimsForWorkingSlot(slot({
      assignment: {
        sourceAssignmentId: "assignment-1",
        userId: "staff-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: null,
        bookingCount: 0,
      },
    }), claims)).toEqual([]);
  });

  it("attaches a claimed trade to the live assignment still on the slot", () => {
    const trades = [{
      id: "trade-1",
      assignmentId: "assignment-1",
      status: "CLAIMED" as const,
      notes: null,
      claimedBy: { id: "student-2", name: "Blair", avatarUrl: null },
      postedBy: { id: "student-1", name: "Alex", avatarUrl: null },
    }];

    expect(tradeForWorkingSlot(slot(), trades)).toBeNull();
    expect(tradeForWorkingSlot(slot({
      assignment: {
        sourceAssignmentId: "assignment-1",
        userId: "student-1",
        status: "DIRECT_ASSIGNED",
        callStartsAt: null,
        callEndsAt: null,
        callNote: null,
        activeTradeId: "trade-1",
        bookingCount: 0,
      },
    }), trades)?.id).toBe("trade-1");
  });

  it("keeps student shift-group pending requests private while staff crew review lives on the working copy", () => {
    const route = readFileSync("src/app/api/shift-groups/route.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const service = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const review = readFileSync("src/components/shift-detail/CrewPendingReview.tsx", "utf8");

    expect(route).toContain("viewerRequestByShiftId");
    expect(route).not.toContain("pendingClaims");
    expect(service).toContain('status: "REQUESTED"');
    expect(service).toContain('status: "CLAIMED"');
    expect(service).toContain("pendingClaims");
    expect(service).toContain("pendingTrades");
    expect(editor).toContain("<CrewPendingReview");
    expect(editor).toContain("canReviewClaims");
    expect(editor).toContain('currentUser?.role === "ADMIN"');
    expect(review).toContain("UserAvatarGroup");
    expect(review).toContain("Approving one student declines the others.");
    expect(editor).toContain("/api/shift-assignments/${id}/${decision}");
    expect(editor).toContain("/api/shift-trades/${id}/${decision}");
  });
});
