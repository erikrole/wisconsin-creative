import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Event detail temporal state", () => {
  const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
  const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
  const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

  it("keeps one definition of where an event sits relative to now", () => {
    // The list grew a NOW badge and a dimmed finished state before detail had
    // either. One shared definition is what stops them drifting apart again.
    expect(models).toContain("enum ScheduleEventTimeState");
    expect(models).toContain("var timeState: ScheduleEventTimeState");
    expect(models).toContain("if endsAt <= now { return .past }");
    expect(models).toContain("if startsAt <= now { return .live }");

    // Both surfaces read the shared property rather than re-deriving it.
    expect(scheduleView).toContain("private var timeState: ScheduleEventTimeState { event.timeState }");
    expect(scheduleView).not.toContain("enum EventTimeState");
    expect(eventDetail).toContain("private var eventHasEnded: Bool { event.timeState == .past }");
    expect(eventDetail).toContain("switch event.timeState {");
  });

  it("states the temporal answer in the detail header", () => {
    expect(eventDetail).toContain('Text("NOW")');
    expect(eventDetail).toContain('Text("Ended")');
    // Cancelled outranks both: a cancelled event is not under way whatever the
    // clock says, so the badges are suppressed rather than stacked.
    expect(eventDetail).toContain("if !eventIsCancelled {");
    expect(eventDetail).toContain("event.timeState == .live && !eventIsCancelled");
  });

  it("keeps the list row's finished and live treatments", () => {
    expect(scheduleView).toContain("timeState == .past ? 0.55 : 1");
    // Live reads entirely in the time gutter now -- red time plus the word --
    // rather than a filled badge inside a heavier red border. No row wash: a
    // tinted card put green venue rails against pink on every live home game.
    expect(scheduleView).toContain('Text("Now")');
    expect(scheduleView).toContain("timeState == .live ? Color.brandPrimary : Color.primary");
    expect(scheduleView).not.toContain("Color.statusBackground(.red) : Color.cardSurface");
  });

  it("does not blank a loaded roster when the staff working copy fails", () => {
    // `displayedShifts` already falls back to the published shifts, so a failed
    // draft overlay never needed to take the crew section down with it.
    expect(eventDetail).toContain("var workingCopyError: String?");
    expect(eventDetail).toContain("workingEditor = try await APIClient.shared.workingScheduleEditor(shiftGroupId: group.id)");
    expect(eventDetail).toContain("workingCopyError = error.localizedDescription");
    expect(eventDetail).toContain("vm.shiftGroup != nil, let workingCopyError = vm.workingCopyError");
    expect(eventDetail).toContain('Text("Showing the published crew")');
    expect(eventDetail).toContain("workingEditor?.eventShifts() ?? shiftGroup?.shifts ?? []");
  });
});
