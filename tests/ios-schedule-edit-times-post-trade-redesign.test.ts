import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("native Schedule edit times and post trade redesign", () => {
  it("makes the shift call window event-aware and quarter-hour based", () => {
    const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const addShift = source("ios/Wisconsin/Views/Schedule/AddShiftSheet.swift");

    expect(detail).toContain("eventTitle: scheduleEventDisplayTitle(event)");
    expect(detail).toContain('scope == .allAssigned ? "Set Student Call Time" : "Edit Call Window"');
    expect(detail).toContain('Text("Call Window")');
    expect(detail).toContain('ShiftDateTimeRow(label: "Call", systemImage: "arrow.right"');
    expect(detail).toContain('ShiftDateTimeRow(label: "End", systemImage: "arrow.left"');
    expect(detail).toContain('scope == .allAssigned ? "Apply to Students" : "Save Call Window"');
    expect(detail).toContain("guard !isSaving, hasChanges, hasValidWindow else { return }");
    expect(detail).toContain('Label("End time must be after call time."');
    expect(detail).toContain('Button("Retry") { Task { await save() } }');
    expect(addShift).toContain("stride(from: 0, through: 23 * 60 + 45, by: 15)");
    expect(addShift).toContain("Array(Set(");
  });

  it("uses one contextual Trade Board posting sheet from both entry points", () => {
    const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const tradeBoard = source("ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift");
    const postTrade = source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift");

    expect(detail).toContain("@State private var postTradeTarget: TradePostCandidate?");
    expect(detail).toContain("PostTradeSheet(candidate: candidate)");
    expect(detail).toContain("TradePostCandidate(");
    expect(detail).not.toContain("postTradeDialogTitle");
    expect(tradeBoard).toContain("PostTradeSheet(myShifts: myShifts)");
    expect(postTrade).toContain("struct TradePostCandidate: Identifiable");
    expect(postTrade).toContain("init(myShifts: [MyShift]");
    expect(postTrade).toContain("init(candidate: TradePostCandidate");
  });

  it("keeps trade ownership consequences, notes, and recovery explicit", () => {
    const postTrade = source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift");

    expect(postTrade).toContain('Text(candidate.isCurrentUser ? "You stay assigned"');
    expect(postTrade).toContain("The shift stays on the schedule until an Admin approves a claim.");
    expect(postTrade).toContain("Optional context for the person claiming it");
    expect(postTrade).toContain("trimmedNotes.isEmpty ? nil : trimmedNotes");
    expect(postTrade).toContain('Text("Couldn\'t post shift")');
    expect(postTrade).toContain('Button("Retry") { Task { await post() } }');
    expect(postTrade).toContain("guard let candidate = selectedCandidate, !isPosting else { return }");
    expect(postTrade).toContain('.interactiveDismissDisabled(hasUnsavedInput || isPosting)');
  });

  it("keeps dates compact and the constructive actions purple", () => {
    const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const postTrade = source("ios/Wisconsin/Views/Schedule/PostTradeSheet.swift");

    expect(detail).toContain("calendar.component(.year, from: date) == calendar.component(.year, from: .now)");
    expect(postTrade).toContain("calendar.component(.year, from: candidate.startsAt) == calendar.component(.year, from: .now)");
    expect(detail).toContain('.tint(Color.statusText(.purple))');
    expect(postTrade).toContain('.tint(Color.statusText(.purple))');
    expect(postTrade).toContain('.accessibilityAddTraits(isSelected ? .isSelected : [])');
  });
});
