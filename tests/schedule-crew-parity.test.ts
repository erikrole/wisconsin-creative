import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const calendar = source("src/app/(app)/schedule/_components/CalendarView.tsx");
const crewSheet = source("src/app/(app)/schedule/_components/ScheduleCrewSheet.tsx");
const list = source("src/app/(app)/schedule/_components/ListView.tsx");
const page = source("src/app/(app)/schedule/page.tsx");
const week = source("src/app/(app)/schedule/_components/WeekView.tsx");
const workingEditor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");

describe("Schedule crew management parity", () => {
  it("routes every staff Week and Calendar event into the shared crew sheet", () => {
    expect(page).toContain("canManageCrew={isStaff}");
    expect(page.match(/onOpenCrew={openCrewSheet}/g)).toHaveLength(2);
    expect(week).toContain("const canManageCrew = isStaff;");
    expect(week).toContain("onClick={() => onOpenCrew(entry)}");
    expect(calendar).toContain("if (canManageCrew)");
    expect(calendar).toContain("onClick={() => onOpenCrew(entry)}");
    expect(week).not.toContain("onSelectGroup");
    expect(calendar).not.toContain("onSelectGroup");
  });

  it("keeps non-staff Week and Calendar cards linked to Event detail", () => {
    expect(week).toContain('<Link href={`/events/${entry.id}`} className={wrapClass}>');
    expect(calendar).toContain('<Link href={`/events/${entry.id}`} className={chipClass}>');
    expect(calendar).toContain('<Link href={`/events/${entry.id}`} className={className}>');
    expect(page).toContain("{isStaff && (");
    expect(page).toContain("<ScheduleCrewSheet");
  });

  it("uses the existing versioned editor instead of a second crew mutation path", () => {
    expect(crewSheet).toContain("<WorkingCrewEditor");
    expect(crewSheet).toContain("entry={workingEntry}");
    expect(crewSheet).toContain("showReleaseCountdown");
    expect(crewSheet).not.toContain("/api/shift-assignments");
    expect(crewSheet).not.toContain("/api/shifts");
    expect(workingEditor).toContain("/working-copy");
    expect(workingEditor).toContain('expectedVersion: data.workingVersion');
  });

  it("offers the same three setup choices and opens the returned group immediately", () => {
    expect(crewSheet).toContain('side: "HOME"');
    expect(crewSheet).toContain('side: "AWAY"');
    expect(crewSheet).toContain('side: "EMPTY"');
    expect(crewSheet).toContain("const groupId = await onSetupCrew(eventId, templateSide)");
    expect(crewSheet).toContain("if (groupId) setCreatedGroupId(groupId)");
    expect(crewSheet).toContain("entry.shiftGroupId ?? createdGroupId");
    expect(page).toContain('parseJsonSafely<{ data?: { id?: string } }>(res)');
    expect(page).toContain("return groupId;");
  });

  it("preserves List as the inline multi-event workstation", () => {
    expect(list).toContain("<WorkingCrewEditor");
    expect(page).toContain("handleListSetupCrew");
    expect(page).toContain("if (groupId) setExpandedRowId(eventId)");
    expect(page).toContain("setSelectedCrewEntryId(eventId)");
    expect(page).toContain("onQuickManageCrew={isStaff ? handleQuickManageCrew : undefined}");
  });

  it("guards setup against competing submissions and malformed success responses", () => {
    expect(crewSheet).toContain("if (setupRef.current) return;");
    expect(crewSheet).toContain("disabled={settingUpSide !== null}");
    expect(page).toContain("if (settingUpRef.current.has(eventId)) return null;");
    expect(page).toContain("Crew setup response was incomplete. Refresh and try again.");
    expect(page).toContain("settingUpRef.current.delete(eventId)");
  });
});
