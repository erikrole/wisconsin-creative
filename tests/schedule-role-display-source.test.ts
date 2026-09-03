import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("schedule staff/student display source contracts", () => {
  it("uses assigned user scheduling-class labels for filled schedule rows", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const eventCrew = source("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx");
    const slotCard = source("src/components/shift-detail/ShiftSlotCard.tsx");
    const picker = source("src/components/shift-detail/UserAvatarPicker.tsx");

    expect(listView).toContain("const assignedClassLabel = user ? shiftWorkerLabelForProfile(user) : null");
    expect(listView).toContain("const assignedClassDiffersFromSlot");
    expect(slotCard).toContain("activeAssignment");
    expect(slotCard).toContain("shiftWorkerLabelForProfile(activeAssignment.user)");
    expect(slotCard).toContain("shiftWorkerSlotLabel(workerType)");
    expect(eventCrew).toContain("shiftWorkerLabelForProfile(activeAssignment.user)");
    expect(eventCrew).toContain("const rowClassLabel = activeAssignment");
    expect(eventCrew).toContain("<TableHead>Person</TableHead>");
    expect(picker).toContain("shiftWorkerTypeForProfile(u)");
    expect(picker).toContain("shiftWorkerLabelForProfile(u)");
    expect(picker).toContain("Will use ${shiftWorkerSlotLabel(candidateWorkerType).toLowerCase()}");
    expect(picker).toContain("leave ${shiftWorkerSlotLabel(slotWorkerType).toLowerCase()} open");
  });

  it("keeps open-coverage needs copy neutral instead of class-specific", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
    const assignmentCell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");

    expect(listView).toContain("<CoverageBadge");
    expect(listView).not.toContain("Needs N people");
    expect(listView).not.toContain("Needs students");
    expect(listView).not.toContain("Student${students");
    expect(readiness).toContain('label: "Crew needed"');
    expect(readiness).toContain('event${needsCoverageEvents === 1 ? "" : "s"} need crew');
    expect(readiness).not.toContain('label: "Staff needed"');
    expect(filters).toContain("Needs crew");
    expect(filters).not.toContain("Needs staff");
    expect(assignmentCell).toContain("openShifts.length");
    expect(assignmentCell).toContain("shiftWorkerSlotLabel(shift.workerType)");
    expect(assignmentCell).not.toContain("Assign open slot");
  });

  it("keeps staff assignment inside the working-copy class gate", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const workingEditor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");
    const assignmentCell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const shiftDetail = source("src/components/ShiftDetailPanel.tsx");
    const route = source("src/app/api/shift-assignments/route.ts");
    const service = source("src/lib/services/schedule-working-copy.ts");

    expect(route).toContain("rejectRetiredLiveScheduleMutation");
    expect(listView).toContain("<WorkingCrewEditor");
    expect(listView).not.toContain("formatRoleSlotAssignmentOutcome");
    expect(workingEditor).toContain('type: "assign"');
    expect(service).toContain("scheduleAssigneeWorkerType(assignee) !== slot.workerType");
    expect(assignmentCell).not.toContain("formatRoleSlotAssignmentOutcome");
    expect(shiftDetail).toContain("canEditPublishedSchedule = false");
  });

  it("shows editable call times only for Student schedule rows", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const workingEditor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");
    const assignmentCell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const slotCard = source("src/components/shift-detail/ShiftSlotCard.tsx");

    expect(listView).toContain("<WorkingCrewEditor");
    expect(workingEditor).toContain('const showCallWindow = !data.allDay && slot.workerType === "ST"');
    expect(workingEditor).toContain('{ type: "setCallWindow"');
    expect(workingEditor).toContain('{ type: "setCallWindowForAll"');
    expect(workingEditor).toContain("Staff and collaborators do not have a call time.");
    expect(listView).toContain("commonCallWindow(entry)");
    expect(listView).toContain('workerKindForShift(shift) !== "ST"');
    expect(listView).toContain('workerType === "ST"');
    expect(listView).toContain("Most rows");
    expect(listView).toContain("!callMatchesCommon");
    expect(listView).toContain("Crew");
    expect(listView).not.toContain("shiftCallSummary");
    expect(listView).not.toContain("mobileCallSummary");
    expect(listView).not.toContain("Assignment detail");
    expect(listView).not.toContain('target={{ type: "slot", id: shift.id }}');
    expect(listView).not.toContain('target={{ type: "assignment", id: activeAssignment.id }}');

    expect(assignmentCell).toContain("formatCallTime(callWindow)");
    expect(assignmentCell).toContain('shift.workerType === "ST"');
    expect(assignmentCell).not.toContain("CallWindowEditor");

    expect(slotCard).toContain('const isStudentSlot = workerType === "ST"');
    expect(slotCard).toContain("const showSlotWindow = studentCallTimeAllowed && isStudentSlot && !isAssigned");
    expect(slotCard).toContain('target={canEdit ? { type: "assignment", id: activeAssignment.id } : undefined}');
  });

  it("never substitutes event time into Staff call-time presentation", () => {
    const dashboardRoute = source("src/app/api/dashboard/route.ts");
    const myShiftsRoute = source("src/app/api/my-shifts/route.ts");
    const dashboardColumn = source("src/app/(app)/dashboard/my-gear-column.tsx");
    const notifications = source("src/lib/services/notifications.ts");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const profile = source("ios/Wisconsin/Views/ProfileNextUp.swift");

    expect((dashboardRoute.match(/a\.shift\.workerType === "ST"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(myShiftsRoute).toContain('a.shift.workerType === "ST"');
    expect(dashboardColumn).toContain('s.workerType === "ST"');
    expect(dashboardColumn).toContain("studentCallWindow && !isFullDayDefault");
    expect(notifications).toContain("const hasStudentCallTime = assignment.workerType === \"ST\"");
    expect(notifications).toContain("dueAt: callStartsAt?.toISOString()");
    expect(notifications).toContain("Student call time:");
    expect(home).toContain('queueCallTime(workerType: shift.workerType');
    expect(home).toContain('guard workerType == "ST", let callStartsAt else { return nil }');
    expect(profile).toContain('if shift.workerType == "ST"');
  });

  it("keeps historical role-slot repair permissioned and audited", () => {
    const route = source("src/app/api/shift-assignments/[id]/repair-role-slot/route.ts");
    const service = source("src/lib/services/shift-assignments.ts");

    expect(route).toContain('requirePermission(user.role, "shift_assignment", "assign")');
    expect(route).toContain("repairRoleSlotMismatch(params.id)");
    expect(route).toContain("createAuditEntry");
    expect(route).toContain("shift_assignment_role_slot_repaired");
    expect(service).toContain("export async function repairRoleSlotMismatch");
    expect(service).toContain("data: { shiftId: targetShift.id }");
  });
});
