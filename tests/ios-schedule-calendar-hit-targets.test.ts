import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS schedule calendar hit targets", () => {
  // The numeral stays compact, but the full day cell carries Apple's 44pt
  // interaction envelope so the calendar does not depend on a tiny glyph hit
  // area. The guard keeps that envelope and its accessibility traits attached.
  it("keeps calendar day buttons tappable at the 44pt interaction envelope", () => {
    const scheduleView = source("ios/Wisconsin/Views/Schedule/ScheduleWeekStrip.swift");

    // One day button serves both the week strip and the month grid.
    expect(scheduleView).toContain("private func dayButton(_ day: Date, isOutsideMonth: Bool = false) -> some View");
    expect(scheduleView.match(/dayButton\(day/g)?.length).toBeGreaterThanOrEqual(2);
    // The month grid bleeds muted neighbouring-month days, like Calendar.
    expect(scheduleView).toContain("private func monthGridDays() -> [Date]");
    expect(scheduleView).toContain("if isOutsideMonth { return Color(.tertiaryLabel) }");
    expect(scheduleView).toContain("DayCell(");
    expect(scheduleView).toContain(".frame(minWidth: 44, minHeight: 44)");
    expect(scheduleView).toContain(".contentShape(Rectangle())");
    expect(scheduleView).toContain(".accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)");
  });
});
