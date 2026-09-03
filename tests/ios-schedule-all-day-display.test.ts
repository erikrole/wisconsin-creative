import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Schedule all-day display", () => {
  it("preserves manual titles and hides call-time chrome for all-day events", () => {
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(models).toContain("var displayAllDay: Bool");
    expect(models).toContain("allDay || hasLocalMidnightSpan");
    expect(models).toContain("func scheduleEventDisplayTitle(_ event: ScheduleEvent) -> String");
    expect(models).toContain("let title = cleanScheduleEventSummary(event.summary)");

    expect(scheduleView).toContain("scheduleEventDisplayTitle(event)");
    expect(scheduleView).toContain("if event.displayAllDay { return \"All day\" }");
    // The row's time now leads the card in a gutter rather than sitting in the
    // meta line, so the all-day substitution lives in `gutterLines`.
    expect(scheduleView).toContain("if event.displayAllDay { return (\"All day\", nil) }");
    expect(scheduleView).not.toContain("return Self.cleanSummary(event.summary)");

    expect(eventDetail).toContain('if event.displayAllDay || myShift?.workerType == "FT" { return nil }');
    expect(eventDetail).toContain("hidesShiftTimes: event.displayAllDay");
    // The stacked crew row layout (large Dynamic Type) and the row's
    // accessibility label gate call-time chrome directly on the flag.
    expect(eventDetail.match(/if studentCallTimeAllowed && !hidesShiftTimes && isStudentSlot \{/g)?.length).toBe(2);
    // The compact layout gates on the area-wide column instead, so Staff rows
    // keep their columns aligned with the Student rows above them. That flag
    // still carries `hidesShiftTimes`, so an all-day event renders no call
    // column at all -- not an em-dash column. It also carries the hoist, so a
    // uniform call window is stated once in the header rather than per row.
    expect(eventDetail).toContain(
      "studentCallTimeAllowed\n            && !hidesShiftTimes\n            && !callWindowIsHoisted\n            && shifts.contains { $0.workerType == \"ST\" }",
    );
    // The hoisted header line is itself all-day aware -- an all-day event has no
    // call window to state, so neither the line nor the column appears.
    expect(eventDetail).toContain("!event.displayAllDay && !studentShifts.isEmpty");
    expect(eventDetail).toContain("if showsCallColumn {");
    expect(eventDetail).toContain("showsCallColumn: showsCallColumn");
    expect(eventDetail).toContain("VStack(alignment: .trailing, spacing: 2)");
    expect(eventDetail).toContain("private var callWindowText: some View");
  });
});
