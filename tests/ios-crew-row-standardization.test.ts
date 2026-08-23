import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

const CREW_ROW = "ios/Wisconsin/Views/Components/CrewRow.swift";
const EVENT_DETAIL = "ios/Wisconsin/Views/EventDetailSheet.swift";
const SCHEDULE = "ios/Wisconsin/Views/ScheduleView.swift";

describe("iOS crew row standardization", () => {
  it("gives native crew surfaces the same vocabulary the web crew rows use", () => {
    const crewRow = source(CREW_ROW);

    // Native sibling of src/components/shift-detail/crew-row.tsx.
    expect(crewRow).toContain("enum CrewSlotState");
    expect(crewRow).toContain("struct CrewStateDot: View");
    expect(crewRow).toContain("struct CrewSlotStatusLabel: View");
    expect(crewRow).toContain("struct CrewTypeLabel: View");
    expect(crewRow).toContain("struct CrewAreaHeading: View");
    expect(crewRow).toContain("func crewWorkerTypeLabel(");

    // Same state wording as the web table.
    expect(crewRow).toContain('case .filled: return "Filled"');
    expect(crewRow).toContain('case .open: return "Open"');
    expect(crewRow).toContain('"1 request waiting"');

    // Same tone mapping as web: filled green, open red, requested orange.
    expect(crewRow).toContain("case .filled: return .green");
    expect(crewRow).toContain("case .open: return .red");
    expect(crewRow).toContain("case .requested: return .orange");
  });

  it("keeps crew type as plain text instead of a capsule column", () => {
    const eventDetail = source(EVENT_DETAIL);

    expect(eventDetail).toContain("CrewTypeLabel(label: workerTypeLabel)");
    expect(eventDetail).toContain("private var workerTypeLabel: String { crewWorkerTypeLabel(shift.workerType) }");
    // The filled capsule and its bespoke colour are gone.
    expect(eventDetail).not.toContain("workerTypeColor");
    expect(eventDetail).not.toContain("background(workerTypeColor.opacity(0.12))");
  });

  it("states slot status as a dot plus neutral label", () => {
    const eventDetail = source(EVENT_DETAIL);

    expect(eventDetail).toContain("CrewSlotStatusLabel(state: .requested, requestCount: 1)");
    expect(eventDetail).toContain("CrewSlotStatusLabel(state: .open)");
    expect(eventDetail).not.toContain('StatusPill(label: "Pending", tone: .orange)');
  });

  it("shows the filled count on area headings, like the web crew table", () => {
    const eventDetail = source(EVENT_DETAIL);
    const schedule = source(SCHEDULE);

    expect(eventDetail).toContain("CrewAreaHeading(area: area, filled: filledCount, total: shifts.count)");
    expect(eventDetail).toContain("shifts.filter { !$0.isOpen }.count");
    expect(schedule).toContain("CrewAreaHeading(area: group.area)");
    // The per-surface area icon switch now lives on CrewAreaHeading.
    expect(eventDetail).not.toContain("private var areaIcon: String");
  });

  it("keeps call times quiet on every crew surface", () => {
    const schedule = source(SCHEDULE);
    const publishedRow = schedule.slice(
      schedule.indexOf("private struct PublishedCrewRow"),
      schedule.indexOf("private struct PublishedEventRowSkeleton"),
    );

    // A call time is data, not an accent colour.
    expect(publishedRow).toContain('Text("Call \\(publishedCallWindow(member))")');
    expect(publishedRow).not.toContain("Color.statusText(.blue)");
  });
});
