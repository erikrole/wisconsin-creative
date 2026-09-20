import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const CREW_SURFACES = {
  eventCrew: "src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx",
  scheduleStaff: "src/app/(app)/schedule/_components/WorkingCrewEditor.tsx",
  scheduleWorker: "src/app/(app)/schedule/_components/ListView.tsx",
  shiftPanelSlot: "src/components/shift-detail/ShiftSlotCard.tsx",
  shiftPanelArea: "src/components/shift-detail/ShiftAreaSection.tsx",
} as const;

describe("crew row standardization", () => {
  it("routes every crew surface through the shared crew-row vocabulary", () => {
    for (const path of Object.values(CREW_SURFACES)) {
      expect(source(path)).toMatch(/from "(?:@\/components\/shift-detail|\.)\/crew-row"/);
    }
  });

  it("keeps state, area and reveal tokens defined once", () => {
    const crewRow = source("src/components/shift-detail/crew-row.tsx");

    // The reveal group name has to be a literal Tailwind can read, so it lives
    // in exactly one place and every row opts into the same group.
    expect(crewRow).toContain("group-hover/crew-row:opacity-100");
    expect(crewRow).toContain("group-focus-within/crew-row:opacity-100");

    for (const path of Object.values(CREW_SURFACES)) {
      const text = source(path);
      // No local reveal strings, tone maps, or hand-rolled status dots.
      expect(text).not.toContain("sm:group-hover/assignment:opacity-100");
      expect(text).not.toContain("sm:group-hover/slot:opacity-100");
      expect(text).not.toMatch(/const [A-Z_]*(?:ROW_REVEAL|DOT_TONE|AREA_VARIANTS|AREA_BADGE_VARIANT)/);
      expect(text).not.toContain('style={{ backgroundColor: "var(--green-text)" }}');
      expect(text).not.toContain('style={{ backgroundColor: "var(--red-text)" }}');
    }
  });

  it("gives staff and workers the same crew read with different affordances", () => {
    const eventCrew = source(CREW_SURFACES.eventCrew);

    // One table, not a staff table and a separate student table.
    expect(eventCrew).toContain("const crewTable = (");
    expect(eventCrew).not.toContain("const staffTable = (");
    expect(eventCrew).not.toContain("const studentTable = (");
    expect(eventCrew).toContain(": crewTable");

    // Schedule and Event detail share buffered staff authoring while workers keep a shared read.
    expect(eventCrew).toContain("<WorkingCrewEditor");
    expect(eventCrew).toContain("showReleaseCountdown={false}");
    expect(eventCrew).toContain("showStudentCallButton={false}");
    expect(eventCrew).toContain("studentCallOpen={studentCallOpen}");
    expect(eventCrew).not.toContain("canEditPublishedSchedule");
    expect(eventCrew).not.toContain("/api/shift-assignments");
    expect(eventCrew).toContain("<ScheduleReleaseNotice");
    expect(eventCrew).not.toContain("Acknowledge");
  });

  it("keeps the crew column order identical across surfaces", () => {
    const eventCrew = source(CREW_SURFACES.eventCrew);
    const scheduleStaff = source(CREW_SURFACES.scheduleStaff);
    const scheduleWorker = source(CREW_SURFACES.scheduleWorker);

    // Call, then Type, then Person.
    expect(eventCrew).toContain('<TableHead className="w-28">Call</TableHead>');
    expect(eventCrew).toContain('<TableHead className="w-24">Type</TableHead>');
    expect(eventCrew).toContain("<TableHead>Person</TableHead>");
    expect(eventCrew.indexOf("Call</TableHead>")).toBeLessThan(eventCrew.indexOf("Type</TableHead>"));
    expect(eventCrew.indexOf("Type</TableHead>")).toBeLessThan(eventCrew.indexOf("Person</TableHead>"));

    expect(scheduleStaff).toContain('const SLOT_ROW_GRID_CLASS = "grid-cols-[4.5rem_4.5rem_minmax(0,1fr)]"');
    // The flat worker list prefixes the same order with an area column.
    expect(scheduleWorker).toContain("grid-cols-[104px_72px_72px_minmax(0,1fr)_auto]");
    expect(scheduleWorker).toContain("<CrewAreaDot");
    expect(scheduleWorker).toContain("{callCell}");
  });

  it("keeps one definition of the shift area labels", () => {
    const duplicate = /const AREA_LABELS: Record<string, string> = \{\s*VIDEO: "Video"/;
    for (const path of [
      ...Object.values(CREW_SURFACES),
      "src/app/(app)/events/[id]/_utils.ts",
      "src/components/shift-detail/UserAvatarPicker.tsx",
    ]) {
      expect(source(path)).not.toMatch(duplicate);
    }
    expect(source("src/types/areas.ts")).toContain('VIDEO: "Video"');
  });

  it("keeps the call-time control's bare form in one component", () => {
    const callWindow = source("src/components/shift-detail/CallWindowEditor.tsx");

    expect(callWindow).toContain('variant?: "chip" | "bare"');
    expect(callWindow).toContain("CREW_CALL_TRIGGER_CLASS");
    // The three separate booleans this replaced must not come back.
    expect(callWindow).not.toContain("showLabel");
    expect(callWindow).not.toContain("showIcon?");
  });
});
