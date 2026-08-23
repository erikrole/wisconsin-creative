import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("schedule assign source wiring", () => {
  it("keeps the month assignment board review-only and hands crew edits to Event detail", () => {
    const assignPage = readFileSync("src/app/(app)/schedule/assign/_components/AssignPageClient.tsx", "utf8");
    const assignmentGrid = readFileSync("src/app/(app)/schedule/assign/_components/AssignmentGrid.tsx", "utf8");
    const assignmentCell = readFileSync("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx", "utf8");

    expect(assignPage).toContain("Review coverage and conflicts here.");
    expect(assignPage).toContain("private working schedule");
    expect(assignPage).not.toContain("/api/users?limit=200&active=true");
    expect(assignmentGrid).toContain("href={`/events/${ev.id}`}");
    expect(assignmentGrid).toContain("Manage crew");
    expect(assignmentCell).toContain("assignment.conflictNote");
    expect(assignmentCell).toContain("openShifts.length");
    expect(assignmentCell).not.toContain("fetch(");
    expect(assignmentCell).not.toContain("UserAvatarPicker");
    expect(assignmentCell).not.toContain("CallWindowEditor");
  });

  it("gives assignment toolbar filters stable rendered metadata", () => {
    const assignPage = readFileSync("src/app/(app)/schedule/assign/_components/AssignPageClient.tsx", "utf8");

    expect(assignPage).toContain('id="assignment-sport-filter"');
    expect(assignPage).toContain('name="assignmentSportFilter"');
    expect(assignPage).toContain('aria-label="Assignment sport filter"');
    expect(assignPage).toContain('id="assignment-area-filter"');
    expect(assignPage).toContain('name="assignmentAreaFilter"');
    expect(assignPage).toContain('aria-label="Assignment area filter"');
  });

  it("keeps auto-fill preview-first in the dedicated Shift detail surface", () => {
    const eventCrew = readFileSync("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx", "utf8");
    const shiftDetail = readFileSync("src/components/ShiftDetailPanel.tsx", "utf8");

    expect(eventCrew).toContain("<WorkingCrewEditor");
    expect(eventCrew).not.toContain("/api/shift-groups/${groupId}/auto-assign/preview");
    expect(eventCrew).not.toContain("Apply recommended assignments");

    expect(shiftDetail).toContain("/api/shift-groups/${group.id}/auto-assign/preview");
    expect(shiftDetail).toContain("Apply recommended assignments");
    expect(shiftDetail).toContain("Nothing changes until you apply.");
  });

  it("retires manual release while preserving the audited reconciliation service", () => {
    const publishRoute = readFileSync("src/app/api/shift-groups/[id]/publish/route.ts", "utf8");
    const acknowledgeRoute = readFileSync("src/app/api/shift-assignments/[id]/acknowledge/route.ts", "utf8");

    expect(publishRoute).toContain('requirePermission(user.role, "shift", "manage")');
    expect(publishRoute).toContain("new HttpError(410");
    expect(publishRoute).not.toContain("publishShiftGroup(");
    const publicationService = readFileSync("src/lib/services/schedule-publication.ts", "utf8");
    expect(publicationService).toContain("createAuditEntryTx(tx");
    expect(publicationService).toContain('"shift_group_republished"');
    expect(publicationService).toContain('"shift_group_published"');

    expect(acknowledgeRoute).toContain("acknowledgeShiftAssignment(params.id");
    expect(acknowledgeRoute).toContain("createAuditEntry");
    expect(acknowledgeRoute).toContain('"shift_assignment_acknowledged"');
    expect(acknowledgeRoute).toContain("acknowledgedAt: result.after.acknowledgedAt");
    expect(acknowledgeRoute).toContain("shiftGroupId: result.shiftGroupId");
  });

  it("routes assignment notifications through the publication-aware schedule policy", () => {
    const assignRoute = readFileSync("src/app/api/shift-assignments/route.ts", "utf8");
    const approveRoute = readFileSync("src/app/api/shift-assignments/[id]/approve/route.ts", "utf8");
    const assignmentRoute = readFileSync("src/app/api/shift-assignments/[id]/route.ts", "utf8");
    const shiftRoute = readFileSync("src/app/api/shifts/[id]/route.ts", "utf8");
    const conflictRefresh = readFileSync("src/lib/services/shift-assignment-conflicts.ts", "utf8");
    const releaseWorkflow = readFileSync("src/workflows/pending-schedule-release.ts", "utf8");
    const assignmentService = readFileSync("src/lib/services/shift-assignments.ts", "utf8");

    expect(assignRoute).toContain("rejectRetiredLiveScheduleMutation()");
    expect(assignmentRoute).toContain("rejectRetiredLiveScheduleMutation()");
    expect(shiftRoute).toContain("rejectRetiredLiveScheduleMutation()");
    expect(approveRoute).toContain("approveRequest(id, { id: user.id, role: user.role })");
    expect(approveRoute).not.toContain("dispatchScheduleAssignmentNotifications");
    expect(assignmentService).toContain('dispatchScheduleAssignmentNotifications(result.id, "approved")');
    expect(assignmentService).toContain('action: actor ? "shift_request_approved" : "shift_request_auto_approved"');
    expect(conflictRefresh).toContain("acknowledged_by_id");
    expect(conflictRefresh).toContain("WHEN CAST(${resetAcknowledgements} AS BOOLEAN) THEN NULL");
    expect(releaseWorkflow).toContain("createPublishedShiftGroupNotifications(shiftGroupId)");
    expect(releaseWorkflow).toContain("notifyPublishedShiftGroupWorkers(shiftGroupId, result.affectedUserIds)");
    expect(releaseWorkflow).toContain("if (!result.before.publishedAt)");
  });
});
