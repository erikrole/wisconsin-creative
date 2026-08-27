import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("schedule open work source contracts", () => {
  it("keeps Open Work separate from trade listing while preserving trade actions", () => {
    const tradeBoard = source("src/components/TradeBoard.tsx");

    expect(tradeBoard).toContain("OpenWorkShift");
    expect(tradeBoard).toContain("Open Shifts");
    expect(tradeBoard).toContain("/api/schedule/open-work");
    expect(tradeBoard).toContain("Available Now");
    expect(tradeBoard).toContain("My Posts");
    expect(tradeBoard).toContain("Waiting or Blocked");
    expect(tradeBoard).toContain("Canceling removes the post; the shift stays assigned to you.");
    expect(tradeBoard).toContain("An admin reviews this before you're on the schedule.");
    // The Admin queue and the student's waiting state are both part of the gate.
    expect(tradeBoard).toContain("Admin Review");
    expect(tradeBoard).toContain("Waiting on Admin");
    expect(tradeBoard).toContain("AvailabilityContextNote");
    expect(tradeBoard).toContain("viewerAvailabilityContext");
    expect(tradeBoard).toContain("claimedByAvailabilityContext");
    expect(tradeBoard).toContain("viewerCanClaim");
    expect(tradeBoard).toContain("viewerClaimReason");
    expect(tradeBoard).toContain("/api/shift-assignments/pickup");
    expect(tradeBoard).toContain("/api/shift-trades/${tradeId}/claim");
    expect(tradeBoard).toContain("/api/shift-trades/${tradeId}/cancel");
    expect(tradeBoard).toContain("Claim shift");
    expect(tradeBoard).toContain("Request sent for Admin approval");
    expect(tradeBoard).toContain("const hasAnyLoadError = loadError || openWorkError");
    expect(tradeBoard).toContain("Trade Board posts are unavailable");
    expect(tradeBoard).toContain("Open Student slots are unavailable");
    expect(tradeBoard).toContain("!hasAnyLoadError && totalRows === 0");
  });

  it("keeps the Open Work read model published, student-slot, and permission scoped", () => {
    const service = source("src/lib/services/schedule-open-work.ts");
    const route = source("src/app/api/schedule/open-work/route.ts");

    expect(route).toContain('requirePermission(user.role, "shift_trade", "view")');
    expect(service).toContain("function futureEffectiveShiftWhere");
    expect(service).toContain("AND: [futureEffectiveShiftWhere(now)]");
    expect(service).toContain("workerType: \"ST\"");
    expect(service).toContain("publishedAt: { not: null }");
    expect(service).toContain("assignments: {\n        none: { status: { in: ACTIVE_STATUSES } },");
    expect(service).toContain("scoreCandidatesForShift");
    expect(service).toContain("availabilityContextFromCandidate");
    expect(service).toContain("availabilityContext,");
    expect(service).toContain('filters.role === "ADMIN"');
  });

  it("keeps pickup mutation audited, publication-safe, and notification-policy wired", () => {
    const service = source("src/lib/services/schedule-open-work.ts");
    const route = source("src/app/api/shift-assignments/pickup/handler.ts");

    expect(route).toContain('requirePermission(user.role, "shift_assignment", "request")');
    expect(route).toContain("pickupOpenShift(body.shiftId, user.id)");
    expect(route).toContain("shift_pickup_requested");
    expect(route).toContain("dispatchScheduleAssignmentNotifications(assignment.id, \"requested\")");
    expect(service).toContain("Draft shifts are not open for pickup");
    expect(service).toContain("Open pickup is available for Student slots only");
    expect(service).toContain("const window = effectiveWindow(shift)");
    expect(service).toContain("if (window.startsAt <= new Date())");
    expect(service).toContain("TransactionIsolationLevel.Serializable");
  });

  it("keeps trade lifecycle freshness checks on effective call windows", () => {
    const service = source("src/lib/services/shift-trades.ts");

    expect(service).toContain("function effectiveAssignmentWindow");
    expect(service).toContain("function futureEffectiveAssignmentWhere");
    expect(service).toContain("function staleEffectiveAssignmentWhere");
    expect(service).toContain("assertShiftNotStarted(effectiveAssignmentWindow(assignment).startsAt)");
    expect(service).toContain("const window = effectiveAssignmentWindow(trade.shiftAssignment)");
    expect(service).toContain("await checkTimeConflict(tx, userId, window.startsAt, window.endsAt)");
    expect(service).toContain("assertShiftNotStarted(effectiveAssignmentWindow(trade.shiftAssignment).startsAt)");
    expect(service).toContain("availabilityContextFromBlocks");
    expect(service).toContain("viewerAvailabilityContext");
    expect(service).toContain("claimedByAvailabilityContext");
    expect(service).toContain("viewerCanClaim");
    expect(service).toContain("viewerClaimReason");
  });

  it("keeps native iOS on the same Open Work contract as web", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");
    const sheet = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    expect(apiClient).toContain("func scheduleOpenWork(area: String? = nil) async throws -> OpenWorkResponse");
    expect(apiClient).toContain("request(path: \"/api/schedule/open-work\"");
    expect(apiClient).toContain("func pickupOpenShift(id: String) async throws");
    expect(apiClient).toContain("request(path: \"/api/shift-assignments/pickup\", method: \"POST\")");
    expect(models).toContain("struct OpenWorkResponse: Codable");
    expect(models).toContain("struct OpenWorkShift: Codable, Identifiable, Hashable");
    expect(models).toContain("struct OpenWorkPickupRequest: Codable, Identifiable, Hashable");
    expect(models).toContain("struct ShiftAvailabilityContext: Codable, Hashable");
    expect(models).toContain("let viewerAvailabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let availabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let viewerCanClaim: Bool?");
    expect(models).toContain("let viewerClaimReason: String?");
    // User-facing iOS title is Trade Board; Open Work remains the API/web term.
    expect(sheet).toContain(".navigationTitle(\"Trade Board\")");
    expect(sheet).toContain("APIClient.shared.scheduleOpenWork(area: areaFilter)");
    // Area filter and paging bring the native board level with web.
    expect(sheet).toContain("func loadMoreTrades()");
    expect(sheet).toContain("shiftTrades(area: areaFilter, limit: pageSize)");
    expect(sheet).toContain("Available Now");
    expect(sheet).toContain("My Posts");
    expect(sheet).toContain("Waiting or Blocked");
    expect(sheet).toContain("An admin reviews this before you're on the schedule.");
    expect(sheet).toContain("Admin Review");
    expect(sheet).toContain("Waiting on Admin");
    expect(sheet).toContain("Canceling removes the post; the shift stays assigned to you.");
    expect(sheet).toContain("trade.viewerCanClaim ?? (!isStaff && trade.viewerAvailabilityContext?.blocking != true)");
    expect(sheet).toContain('var canReview: Bool { currentUserRole == "ADMIN" }');
    expect(sheet).toContain("TradeBoardSourceErrorRow(");
  });
});
