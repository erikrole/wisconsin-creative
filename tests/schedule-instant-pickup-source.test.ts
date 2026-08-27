import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAllowedRoles } from "@/lib/permissions";

function source(path: string) {
  return readFileSync(path, "utf8");
}

/**
 * Student claims are approval-first on both paths: an open Student slot becomes
 * a REQUESTED assignment, and a Trade Board claim holds the post as CLAIMED.
 * Admins resolve both. These are the assertions that keep the two paths from
 * silently diverging again — the previous instant-claim policy drifted into a
 * half-removed state precisely because nothing pinned it.
 */
describe("Schedule claim-approval contract", () => {
  it("keeps both worker entry routes on one approval-first implementation", () => {
    const pickupRoute = source("src/app/api/shift-assignments/pickup/route.ts");
    const pickupHandler = source("src/app/api/shift-assignments/pickup/handler.ts");
    const compatibilityRoute = source("src/app/api/shift-assignments/request/route.ts");

    expect(pickupRoute).toContain("withAuth(handleOpenShiftPickup)");
    expect(pickupHandler).toContain("pickupOpenShift(body.shiftId, user.id)");
    expect(pickupHandler).toContain('action: "shift_pickup_requested"');
    expect(pickupHandler).toContain('dispatchScheduleAssignmentNotifications(assignment.id, "requested")');
    // Admins cannot review a queue nobody tells them filled.
    expect(pickupHandler).toContain("notifyPickupRequestReviewers(assignment.id)");
    expect(compatibilityRoute).toContain("withAuth(handleOpenShiftPickup)");
  });

  it("files an open-slot claim as a pending request that holds no slot", () => {
    const openWork = source("src/lib/services/schedule-open-work.ts");

    expect(openWork).toContain('status: "REQUESTED"');
    // REQUESTED sits outside ACTIVE_ASSIGNMENT_STATUSES, which is what keeps a
    // pending request out of My Shifts, the ICS feed, and conflict checks.
    expect(openWork).not.toContain('status: "DIRECT_ASSIGNED"');
    // Acknowledgement would show the student as confirmed for a slot they do
    // not hold.
    expect(openWork).not.toContain("acknowledgedAt: new Date()");
    // Several students may want one slot; approveRequest picks the winner and
    // declines the rest. Requesting must not pre-empt that.
    expect(openWork).not.toContain('where: { shiftId, status: "REQUESTED" }');
    expect(openWork).toContain("You already have a request waiting on this shift");
  });

  it("holds a trade claim for review instead of swapping on the spot", () => {
    const trades = source("src/lib/services/shift-trades.ts");
    const claim = trades.slice(
      trades.indexOf("export async function claimTrade"),
      trades.indexOf("export async function approveTrade"),
    );

    expect(claim).toContain('status: "CLAIMED"');
    // The swap belongs to approveTrade. Claiming must not run it, or the gate
    // is decorative.
    expect(claim).not.toContain("executeSwap(");
    expect(claim).not.toContain("badges.onTradeCompleted");
    // The guards executeSwap used to carry have to survive at claim time.
    expect(claim).toContain("no longer held by the poster");
    expect(claim).toContain("already has an active assignment");
  });

  it("keeps the Admin review routes permission-gated for both queues", () => {
    const tradeApprove = source("src/app/api/shift-trades/[id]/approve/route.ts");
    const tradeDecline = source("src/app/api/shift-trades/[id]/decline/route.ts");
    const assignApprove = source("src/app/api/shift-assignments/[id]/approve/route.ts");
    const assignDecline = source("src/app/api/shift-assignments/[id]/decline/route.ts");

    expect(tradeApprove).toContain('requirePermission(user.role, "shift_trade", "approve")');
    expect(tradeDecline).toContain('requirePermission(user.role, "shift_trade", "approve")');
    expect(assignApprove).toContain('requirePermission(user.role, "shift_assignment", "approve")');
    expect(assignDecline).toContain('requirePermission(user.role, "shift_assignment", "approve")');
    expect(getAllowedRoles("shift_trade", "approve")).toEqual(["ADMIN"]);
    expect(getAllowedRoles("shift_assignment", "approve")).toEqual(["ADMIN"]);
  });

  it("keeps approval audit and worker notification ownership in services", () => {
    const tradeApprove = source("src/app/api/shift-trades/[id]/approve/route.ts");
    const assignApprove = source("src/app/api/shift-assignments/[id]/approve/route.ts");
    const trades = source("src/lib/services/shift-trades.ts");
    const assignments = source("src/lib/services/shift-assignments.ts");

    expect(tradeApprove).toContain("approveTrade(id, { id: user.id, role: user.role })");
    expect(assignApprove).toContain("approveRequest(id, { id: user.id, role: user.role })");
    expect(tradeApprove).not.toContain("createAuditEntry");
    expect(assignApprove).not.toContain("createAuditEntry");
    expect(trades).toContain('action: actor ? "trade_approved" : "trade_auto_approved"');
    expect(assignments).toContain('action: actor ? "shift_request_approved" : "shift_request_auto_approved"');
    expect(assignments).toContain('dispatchScheduleAssignmentNotifications(result.id, "approved")');
  });
});
