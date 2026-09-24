import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// Contracts from the Schedule stress-test pass: each assertion pins a fix for
// a failure that was reproduced by reading the code.
describe("Schedule stress-test hardening", () => {
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const strip = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");
  const cache = source("ios/Wisconsin/Core/ScheduleWindowCache.swift");
  const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
  const assign = source("ios/Wisconsin/Views/Schedule/AssignStudentSheet.swift");
  const addShift = source("ios/Wisconsin/Views/Schedule/AddShiftSheet.swift");
  const board = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");

  it("never lets a reload wipe weeks another load added", () => {
    expect(schedule).toContain("private func replace(_ window: DateInterval, with result: ([ScheduleEvent], [MyShift]))");
    expect(schedule).toContain("replace(window, with: (fetchedEvents, fetchedShifts))");
    expect(schedule).not.toContain("rawEventsById = Dictionary(fetchedEvents.map");
    // Bounds only grow.
    expect(schedule).toContain("loadedStart = min(loadedStart, newStart)");
    expect(schedule).toContain("loadedEnd = max(loadedEnd, newEnd)");
    // A stale foreground reload stays one bounded read.
    expect(schedule).toContain("private var reloadWindow: DateInterval");
  });

  it("opens pushes that launched the app, and events outside the range", () => {
    expect(schedule).toContain("if let eventId = appState.pendingPushEventId {\n                    routePendingPush(eventId)");
    expect(schedule).toContain("if let loadTask { await loadTask.value }");
    expect(schedule).toContain("linkedEvents[fetched.id] = fetched");
    expect(schedule).toContain("vm.events.first(where: { $0.id == route.id }) ?? vm.linkedEvents[route.id]");
  });

  it("keeps a filtered list loading instead of dead-ending", () => {
    expect(schedule).toContain("if activeFilterCount > 0, vm.reachedLatest,");
    expect(schedule).toContain(".id(vm.loadedEnd)");
    expect(schedule).toContain("revealSettlingCount == 0");
    expect(strip).toContain("var onShowMonth: (Date) -> Void = { _ in }");
    expect(schedule).toContain("hasShift: group.events.contains { vm.shiftsByEventId[$0.id] != nil }");
  });

  it("writes the cache in order and clears it before the next session", () => {
    expect(cache).toContain('private static let queue = DispatchQueue(label: "schedule-window-cache", qos: .utility)');
    expect(cache).toContain("queue.sync {");
  });

  it("guards Event detail mutations and recovers from version conflicts", () => {
    expect(detail).toContain("@State private var slotsInFlight: Set<String> = []");
    expect(detail).toContain("if case APIError.conflict = error {");
    expect(detail).toContain("Task { await vm.load(forceRefresh: true) }");
    expect(detail).toContain("manager.setActionName(label)");
    expect(detail).not.toContain('"Undo (label)")');
    expect(detail).toContain("onEditTimes: event.displayAllDay ? nil :");
    expect(detail).toContain('title: "Remove the assignment first"');
    expect(detail).toContain("_startsAt = State(initialValue: Self.roundedToQuarterHour(");
    for (const sheet of [assign, addShift]) {
      expect(sheet).toContain("var refreshWorkingVersion: (() async -> Int?)?");
      expect(sheet).toContain("canRetryConflict = false");
    }
    expect(addShift).toContain("if !isAllDay { scheduleCard }");
  });

  it("never reads a Trade Board decision as a failure, and confirms declines", () => {
    expect(apiClient).toContain("func approveShiftTrade(id: String) async throws {");
    expect(apiClient).toContain("private func sendDecision(path: String, fallback: String) async throws");
    expect(board).toContain("@State private var pendingDecline: PendingDecline?");
    expect(board).toContain('return "Decline \\(who)\'s request?"');
    expect(board).toContain("return Color.statusText(venueTone(event.venue))");
    expect(source("ios/Wisconsin/Models/ShiftTradeModels.swift")).toContain("var venue: ScheduleVenue {");
    expect(source("src/lib/services/schedule-open-work.ts")).toContain("site: true,");
    expect(source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift")).toContain(
      ".filter { ($0.callStartsAt ?? $0.startsAt) > now && $0.statusValue == .active }",
    );
  });

  it("keeps the shift calendar feed published-only and its token private", () => {
    const feed = source("src/app/api/shifts/ics/[token]/route.ts");
    expect(feed).toContain("shiftGroup: { publishedAt: { not: null }, event: { status: \"CONFIRMED\", archivedAt: null } },");
    // The credential itself never leaves the server after it is minted.
    expect(source("src/app/api/users/[id]/route.ts")).toContain("hasIcsToken: isSelf ? Boolean(target.icsToken) : undefined,");
    expect(source("src/app/api/users/[id]/route.ts")).not.toContain("icsToken: isSelf ? (target.icsToken");
    expect(source("src/lib/services/user-deactivation.ts")).toContain(": { active: false, icsToken: null },");
    expect(source("src/app/api/users/[id]/role/route.ts")).toContain('...(body.role === "COLLABORATOR" ? { icsToken: null } : {}),');
    expect(source("src/app/(app)/users/[id]/UserInfoTab.tsx")).toContain('title: "Reset private link?"');
    expect(source("ios/Wisconsin/Shared/AppEnvironment.swift")).toContain('webcal://\\(activeAPIHost)');
    expect(source("src/app/api/my-shifts/route.ts")).toContain('status: { not: "CANCELLED" },');
  });
});

describe("Schedule follow-up hardening (drafts, claims, token)", () => {
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
  const models = source("ios/Wisconsin/Models/ScheduleModels.swift");

  it("pins every draft edit to the draft on screen", () => {
    expect(models).toContain("let draftId: String?");
    expect(apiClient).toContain("private func rememberDraft(_ editor: WorkingScheduleEditor) -> WorkingScheduleEditor");
    expect(apiClient).toContain("try container.encodeNil(forKey: .expectedDraftId)");
    expect(apiClient).toContain('items.append(.init(name: "expectedDraftId", value: expected ?? ""))');
    expect(source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx")).toContain("expectedDraftId: data.draftId ?? null");
  });

  it("shows pending student claims on open slots and opens the Trade Board", () => {
    expect(models).toContain("let pendingClaims: [WorkingPendingClaim]?");
    expect(models).toContain(".filter { $0.shiftId == slot.sourceShiftId }");
    expect(detail).toContain("if canManageShifts, let onReviewClaims, !shift.pendingClaimNames.isEmpty {");
    expect(detail).toContain("onReviewClaims: canManageShifts ? { showTradeBoard = true } : nil");
    expect(detail).toContain(".sheet(isPresented: $showTradeBoard, onDismiss: {");
  });

  it("keeps the feed token hashed and the link on the device", () => {
    const store = source("ios/Wisconsin/Core/ShiftCalendarTokenStore.swift");
    expect(store).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(source("ios/Wisconsin/App/WisconsinApp.swift")).toContain("ShiftCalendarTokenStore.removeAll()");
    expect(source("ios/Wisconsin/Views/Schedule/ScheduleCalendarSubscriptionSheet.swift")).toContain('return hasServerToken ? "Get a New Link" : "Set Up in Apple Calendar"');
    // An old server ignores eventId; never open the wrong event.
    expect(apiClient).toContain("first.id == id || (first.combinedEvents ?? []).contains(where: { $0.id == id }) else { return nil }");
  });

  it("uses personal call time and UTC dates on Trade Board rows, and notes a capped list", () => {
    const board = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    expect(board).toContain("func dateTimeLine(personalStartsAt: Date?, personalEndsAt: Date?) -> String");
    expect(board).toContain("personalStartsAt: trade.shiftAssignment.callStartsAt,");
    expect(board).toContain("vm.openWork.openShiftsTruncated || vm.openWork.pickupRequestsTruncated");
  });
});
