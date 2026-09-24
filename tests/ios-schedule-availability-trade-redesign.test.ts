import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("native Schedule availability and Trade Board redesign", () => {
  it("makes weekly availability interactive and existing blocks editable", () => {
    const view = source("ios/Wisconsin/Views/AvailabilityView.swift");
    const client = source("ios/Wisconsin/Core/APIClient.swift");
    const updateRoute = source("src/app/api/users/[id]/availability/[blockId]/route.ts");

    expect(view).toContain("AvailabilityWeekStrip(");
    expect(view).toContain("@Binding var selectedDay: Int");
    expect(view).toContain("editorContext = .edit(block)");
    expect(view).toContain(
      "context.block == nil ? (kind == .weekly ? \"Add Class Schedule\" : \"Add Day Away\") : \"Edit Availability\""
    );
    expect(view).toContain("stride(from: 0, through: 23 * 60 + 45, by: 15)");
    expect(view).toContain("One-off days and ranges");
    expect(client).toContain("func updateAvailabilityBlock(");
    expect(client).toContain("/availability/\\(blockId)\", method: \"PATCH\"");
    expect(updateRoute).toContain("export const PATCH");
    expect(updateRoute).toContain("recomputeFutureAssignmentAvailabilityConflictsForUser(id)");
  });

  it("keeps Availability in the Schedule flow for Student workers", () => {
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");

    expect(schedule).toContain("session.currentUser?.staffingType == \"ST\"");
    expect(schedule).toContain("Label(\"My Availability\", systemImage: \"calendar.badge.clock\")");
    expect(schedule).toContain(".navigationDestination(isPresented: $showAvailability)");
    expect(schedule).toContain("AvailabilityView(userId: session.currentUser?.id ?? \"\")");
  });

  it("separates trade posts from open shifts and keeps My Posts a quiet scope", () => {
    const board = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const models = source("ios/Wisconsin/Models/ShiftTradeModels.swift");

    expect(board).toContain("@State private var mineOnly = false");
    expect(board).toContain("TradeBoardSummaryCard(");
    expect(board).toContain("Show my trade posts");
    expect(board).toContain("private var availableContent");
    expect(board).toContain("private var myPostsContent");
    expect(board).toContain('title: "Trade Posts"');
    expect(board).toContain('title: "Open Shifts"');
    expect(board).toContain("Shifts another student posted for coverage.");
    expect(board).toContain("Unassigned Student slots.");
    expect(board).not.toContain('title: "Available Now"');
    expect(board).toContain("dateTimeLine");
    expect(board).toContain("classificationColor");
    expect(board).toContain(".buttonStyle(.borderedProminent)");
    expect(board).toContain("cancelAction: nil");
    expect(board).not.toContain("} cancelAction: {}");
    expect(models).toContain("let viewerAvailabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let claimedByAvailabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let availabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let viewerCanClaim: Bool?");
    expect(board).toContain("var blockedTrades: [ShiftTrade]");
    expect(board).toContain("trade.viewerCanClaim ?? (!isStaff && trade.viewerAvailabilityContext?.blocking != true)");
    expect(board).toContain("ShiftAvailabilityContextNote(");
  });

  it("prevents duplicate trade mutations and preserves recovery", () => {
    const board = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    // Busy state is per row, and every action reloads the board after.
    expect(board).toContain("@State private var pendingActionIds: Set<String> = []");
    expect(board).toContain("guard pendingActionIds.insert(actionId).inserted else { return }");
    expect(board).toContain("await vm.load(forceRefresh: true)");
    expect(board).toContain(".disabled(isActioning)");
    expect(board).toContain("TradeBoardActionErrorBanner(");
    expect(board).toContain("var tradeLoadError: String?");
    expect(board).toContain("var openWorkLoadError: String?");
    expect(board).toContain("func loadTrades(forceRefresh: Bool = false) async");
    expect(board).toContain("func loadOpenWork(forceRefresh: Bool = false) async");
    expect(board).toContain("TradeBoardSourceErrorRow(");
    expect(board).toContain("isComplete: !vm.hasSourceFailure");
  });
});
