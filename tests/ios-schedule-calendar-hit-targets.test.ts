import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS schedule calendar hit targets", () => {
  // The numeral stays compact, but the full day cell carries Apple's 44pt
  // interaction envelope so the calendar does not depend on a tiny glyph hit
  // area. The guard keeps that envelope and its accessibility traits attached.
  it("keeps calendar day buttons tappable at the 44pt interaction envelope", () => {
    const scheduleView = source("ios/Wisconsin/Views/ScheduleView.swift");

    expect(scheduleView).toContain("Button {\n                            withAnimation(.easeInOut(duration: 0.15))");
    expect(scheduleView).toContain("DayCell(");
    expect(scheduleView).toContain(".frame(minWidth: 44, minHeight: 44)");
    expect(scheduleView).toContain(".contentShape(Rectangle())");
    expect(scheduleView).toContain(".accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)");
  });
});
