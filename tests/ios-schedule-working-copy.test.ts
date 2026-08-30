import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiClient = readFileSync("ios/Wisconsin/Core/APIClient.swift", "utf8");
const scheduleModels = readFileSync("ios/Wisconsin/Models/ScheduleModels.swift", "utf8");
const eventDetail = readFileSync("ios/Wisconsin/Views/EventDetailSheet.swift", "utf8");
const assignSheet = readFileSync("ios/Wisconsin/Views/Schedule/AssignStudentSheet.swift", "utf8");
const models = readFileSync("ios/Wisconsin/Models/Models.swift", "utf8");
const addSheet = readFileSync("ios/Wisconsin/Views/Schedule/AddShiftSheet.swift", "utf8");

describe("native schedule working-copy adoption", () => {
  it("keeps the working-copy API additive and version checked", () => {
    expect(apiClient).toContain("/api/shift-groups/\\(shiftGroupId)/working-copy");
    expect(apiClient).toContain("func workingScheduleEditor");
    expect(apiClient).toContain("func discardWorkingSchedule");
    expect(apiClient).toContain("func convertAndReplaceWorkingScheduleSlot");
    expect(apiClient).toContain("type: \"convertAndReplace\"");
    expect(apiClient).not.toContain("func publishWorkingSchedule");
    expect(apiClient).toContain("expectedVersion: Int");
  });

  it("decodes private draft identity and effective call windows without changing published models", () => {
    expect(scheduleModels).toContain("struct WorkingScheduleEditor: Codable, Identifiable");
    expect(scheduleModels).toContain("struct WorkingScheduleDefaultWindow: Codable");
    expect(scheduleModels).toContain("let defaultWindow: WorkingScheduleDefaultWindow?");
    expect(scheduleModels).toContain("let autoReleaseAt: Date?");
    expect(scheduleModels).toContain("struct WorkingScheduleSlot: Codable, Identifiable");
    expect(scheduleModels).toContain("var effectiveStartsAt: Date { callStartsAt ?? startsAt }");
    expect(scheduleModels).toContain("sourceAssignmentId ?? \"working:\\(slot.key)\"");
    expect(scheduleModels).toContain("struct SchedulePublicationState: Codable");
    expect(scheduleModels).toContain('case "SOCIAL":   return "Social"');
    expect(addSheet).toContain('case social = "SOCIAL"');
    expect(eventDetail).toContain('"VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS"');
  });

  it("loads staff drafts and routes authoring through working-copy commands", () => {
    expect(eventDetail).toContain("vm.load(includeWorkingCopy: canManageShifts)");
    expect(eventDetail).toContain("workingScheduleEditor");
    expect(eventDetail).toContain("defaultStart: vm.workingEditor?.defaultWindow?.startsAt ?? event.startsAt");
    expect(eventDetail).toContain("defaultEnd: vm.workingEditor?.defaultWindow?.endsAt ?? event.endsAt");
    expect(eventDetail).toContain("unassignWorkingScheduleSlot");
    expect(eventDetail).toContain("removeWorkingScheduleSlot");
    expect(eventDetail).toContain("setWorkingScheduleCallWindow");
    expect(apiClient).toContain("setWorkingScheduleCallWindowForAll");
    expect(apiClient).toContain('type: "setCallWindowForAll"');
    expect(eventDetail).toContain("Set Student call time");
    expect(eventDetail).toContain("scope: .allAssigned");
    expect(eventDetail).toContain("addWorkingScheduleSlot");
    expect(eventDetail).not.toContain("publishWorkingSchedule");
    expect(eventDetail).toContain("Editing again restarts the 10-minute timer");
    expect(eventDetail).toContain("discardWorkingSchedule");
    expect(eventDetail).toContain("onConvertAndReplace");
    expect(eventDetail).toContain("Replace and Convert…");
    expect(eventDetail).toContain("isWorkingCopy: canManageShifts && vm.workingEditor != nil");
    expect(eventDetail).not.toContain("APIClient.shared.updateShiftTimes");
    expect(eventDetail).not.toContain("APIClient.shared.deleteShift(");
    expect(eventDetail).not.toContain("APIClient.shared.addShift(");
    expect(eventDetail).not.toContain("APIClient.shared.unassignShift(");
  });

  it("uses draft slot keys for assignment and add-slot quick actions", () => {
    expect(assignSheet).toContain("workingScheduleCandidateScores");
    expect(assignSheet).toContain("assignWorkingScheduleSlot");
    expect(assignSheet).toContain("convertAndReplaceWorkingScheduleSlot");
    expect(assignSheet).toContain("replacementWorkerType");
    expect(assignSheet).toContain("workerType: targetWorkerType");
    expect(assignSheet).toContain("expectedWorkingVersion");
    expect(assignSheet).toContain('policy?.status == "ACTIVE"');
    expect(assignSheet).toContain('contains("PUBLISHED_SCHEDULE_VIEW")');
    expect(models).toContain("let collaboratorPolicy: CollaboratorPolicy?");
    expect(assignSheet).not.toContain("APIClient.shared.assignShift(");
    expect(addSheet).toContain("addWorkingScheduleSlot");
    expect(addSheet).toContain("Uses the configured call time");
    expect(addSheet).toContain("callStartsAt: workerType == .student && customizeTimes ? startsAt : nil");
    expect(addSheet).toContain("Staff and collaborators do not have a separate call time.");
    expect(addSheet).not.toContain("APIClient.shared.addShift(");
  });

  it("exposes named server-backed undo and redo through the system edit routes", () => {
    expect(apiClient).toContain("func undoWorkingSchedule");
    expect(apiClient).toContain("func redoWorkingSchedule");
    expect(apiClient).toContain('action: "undo"');
    expect(apiClient).toContain('action: "redo"');
    expect(scheduleModels).toContain("struct WorkingScheduleHistoryAction: Codable");
    expect(scheduleModels).toContain("let canUndo: Bool?");
    expect(scheduleModels).toContain("let canRedo: Bool?");
    expect(scheduleModels).toContain("var hasUndo: Bool");
    expect(scheduleModels).toContain("var hasRedo: Bool");
    expect(eventDetail).toContain("ScheduleWorkingCopyUndoCoordinator");
    expect(eventDetail).toContain("@Environment(\\.undoManager)");
    expect(eventDetail).toContain('keyboardShortcut("z", modifiers: .command)');
    expect(eventDetail).toContain('keyboardShortcut("z", modifiers: [.command, .shift])');
    expect(eventDetail).toContain("workingHistoryError");
    expect(eventDetail).toContain("acceptWorkingScheduleEditor");
    expect(eventDetail).toContain("Revert Pending Changes");
  });
});
