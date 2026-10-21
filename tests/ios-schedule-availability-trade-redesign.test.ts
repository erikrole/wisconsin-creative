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

    // Four tabs (Review is Admin-only), one list per tab, grouped by day.
    expect(board).toContain("@State private var selectedTab: BoardTab?");
    expect(board).toContain("(vm.canReview ? [.review] : []) + [.available, .mine, .history]");
    expect(board).toContain("TradeBoardTabBar(");
    expect(board).toContain("private func dayGroups(_ rows: [BoardRowModel]) -> [BoardDayGroup]");
    expect(board).toContain('return "Today · \\(base)"');
    // One Available list holds both kinds, soonest first.
    expect(board).toContain("case trade(ShiftTrade)");
    expect(board).toContain("case open(OpenWorkShift)");
    expect(board).toContain(".sorted { $0.startsAt < $1.startsAt }");
    expect(board).not.toContain('title: "Available Now"');
    expect(board).toContain("timesLine");
    expect(board).toContain("classificationColor");
    expect(board).toContain(".modifier(BoardButtonStyle(style: action.style))");
    expect(board).toContain("picker.pickerStyle(.segmented)");
    expect(board).not.toContain("mineOnly");
    expect(board).not.toContain("TradeBoardSummaryCard");
    expect(models).toContain("let viewerAvailabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let claimedByAvailabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let availabilityContext: ShiftAvailabilityContext?");
    expect(models).toContain("let viewerCanClaim: Bool?");
    expect(board).toContain("var blockedTrades: [ShiftTrade]");
    expect(board).toContain("trade.viewerCanClaim ?? (!isStaff && trade.viewerAvailabilityContext?.blocking != true)");
    expect(board).toContain("availabilityNotices(trade.viewerAvailabilityContext)");
  });

  it("prevents duplicate trade mutations and preserves recovery", () => {
    const board = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");

    // Busy state is per row, and every action reloads the board after.
    expect(board).toContain("@State private var pendingActionIds: Set<String> = []");
    expect(board).toContain("guard pendingActionIds.insert(actionId).inserted else { return }");
    expect(board).toContain("await vm.load(forceRefresh: true)");
    expect(board).toContain(".disabled(isBusy)");
    expect(board).toContain("TradeBoardActionErrorBanner(");
    expect(board).toContain("var tradeLoadError: String?");
    expect(board).toContain("var openWorkLoadError: String?");
    expect(board).toContain("func loadTrades(forceRefresh: Bool = false) async");
    expect(board).toContain("func loadOpenWork(forceRefresh: Bool = false) async");
    expect(board).toContain("TradeBoardSourceErrorRow(");
    expect(board).toContain("if !vm.hasSourceFailure {");
  });
});
