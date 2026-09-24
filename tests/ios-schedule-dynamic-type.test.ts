import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS Schedule Dynamic Type", () => {
  it("uses semantic fonts in the visible list date header", () => {
    const rowFile = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const dateHeader = sliceBetween(rowFile, "struct ScheduleDateHeader: View", "private var headerAccessibilityLabel");

    expect(dateHeader).toContain(".font(.headline)");
    expect(dateHeader).toContain(".font(.subheadline)");
    expect(dateHeader).toContain(".font(.caption.monospacedDigit())");
    expect(dateHeader).not.toContain(".font(.system(size:");
    expect(dateHeader).toContain(".textCase(nil)");
  });

  it("keeps schedule row microcopy on semantic Dynamic Type styles", () => {
    const rowFile = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const crewRow = source("ios/Wisconsin/Views/Components/CrewRow.swift");
    const eventRow = sliceBetween(rowFile, "struct EventRow: View", "private func calendarSame");

    expect(eventRow).toContain(".font(.body.weight(.semibold))");
    expect(eventRow).toContain(".font(.subheadline.weight(.semibold))");
    expect(eventRow).toContain(".font(.subheadline)");
    // Trailing time column: semantic styles with tabular figures.
    expect(eventRow).toContain(".font(.subheadline.weight(.semibold).monospacedDigit())");
    expect(eventRow).toContain(".font(.caption.monospacedDigit())");
    expect(eventRow).not.toContain(".font(.system(size:");
    expect(crewRow).toContain(".font(.caption.weight(.semibold).monospacedDigit())");
    expect(crewRow).not.toContain(".font(.system(size:");
  });

  // A fixed-width container around scaling text clips it. The trailing time
  // column sizes to its own text instead of a constant width.
  it("lets the time column size to its text", () => {
    const rowFile = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const timeColumn = sliceBetween(rowFile, "private var timeColumn: some View", "// MARK: Meta");

    expect(timeColumn).toContain(".fixedSize()");
    expect(timeColumn).not.toMatch(/\.frame\(width: \d+/);
  });

  it("keeps the coverage ratio on one line", () => {
    const crewRow = source("ios/Wisconsin/Views/Components/CrewRow.swift");
    const chip = sliceBetween(
      crewRow,
      "struct CoverageChip: View",
      "func crewReadinessSummary",
    );

    // "4/6" must not break into "4/" above "6" when text scales up.
    expect(chip).toContain(".lineLimit(1)");
    expect(chip).toContain(".fixedSize(horizontal: true, vertical: false)");
  });
});
