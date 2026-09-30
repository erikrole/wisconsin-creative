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

  it("keeps publish-now behind the explicit publication permission", () => {
    const publishRoute = readFileSync("src/app/api/shift-groups/[id]/publish/route.ts", "utf8");
    const acknowledgeRoute = readFileSync("src/app/api/shift-assignments/[id]/acknowledge/route.ts", "utf8");

    expect(publishRoute).toContain('requirePermission(user.role, "shift", "publish_now")');
    expect(publishRoute).toContain("publishShiftGroup(");
    expect(publishRoute).toContain("expectedVersion");
    expect(publishRoute).toContain("requireWorkingCopy: true");
    expect(publishRoute).toContain("createPublishedShiftGroupNotifications");
    const publicationService = readFileSync("src/lib/services/schedule-publication.ts", "utf8");
    expect(publicationService).toContain("createAuditEntryTx(tx");
    expect(publicationService).toContain('"shift_group_republished"');
    expect(publicationService).toContain('"shift_group_republished_now"');
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

describe("schedule working-copy route wiring", () => {
  it("keeps every editor operation permissioned, rate-limited, and version checked", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const service = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");

    expect(route).toContain('requirePermission(user.role, "shift", "manage")');
    expect(route).toContain("enforceRateLimit");
    expect(route).toContain("expectedVersion");
    expect(route).toContain("workingScheduleCommandSchema");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("createAuditEntryTx(tx");
    expect(service).toContain("where: { shiftGroupId, version: expectedVersion }");
    expect(service).toContain("sportDefaultShiftWindow");
    expect(service).toContain("defaultWindow");
    expect(service).toContain("allDay: true");
  });

  it("routes undo and redo through the same permissioned version boundary", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const service = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");

    expect(route).toContain("const historySchema");
    expect(route).toContain('action: z.enum(["undo", "redo"])');
    expect(route).toContain("changeWorkingScheduleHistory");
    expect(route).toContain('"action" in body');
    expect(route).toContain("getWorkingScheduleEditor(params.id, user.id)");
    expect(service).toContain("entry.actorId !== actor.id");
    expect(service).toContain("WORKING_SCHEDULE_HISTORY_LIMIT");
    expect(service).toContain("redoStack: historyJson([])");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
  });

  it("keeps pending edits private and starts the exact-version release timer before saving", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const workingService = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const release = readFileSync("src/lib/schedule-release.ts", "utf8");

    expect(editor).toContain("/working-copy");
    expect(editor).toContain("/publish");
    expect(editor).toContain("Publish now");
    expect(editor).toContain("Apply correction now");
    expect(editor).toContain("formatScheduleReleaseCountdown");
    expect(release).toContain("Release scheduled in");
    expect(route).toContain("enqueuePendingScheduleRelease");
    expect(route).toContain("getWorkingScheduleEventEndsAt");
    expect(route).toContain("const eventHasEnded");
    expect(route).toContain("const autoRelease = eventHasEnded");
    expect(route).toContain("publishEndedWorkingSchedule");
    expect(route).toContain("badges.onShiftsWorked({ userId }, { notify: false })");
    expect(route.indexOf("await enqueuePendingScheduleRelease")).toBeLessThan(route.indexOf("await mutateWorkingSchedule"));
    expect(route).toContain("version: body.expectedVersion + 1");
    expect(editor).toContain('type: "setCallWindow"');
    expect(editor).toContain('type: "setCallWindowForAll"');
    expect(editor).toContain("Student call time");
    expect(editor).toContain("Staff and collaborators do not have a call time");
    expect(editor).toContain("data?.assignedUsers");
    expect(editor).toContain("<CrewPendingReview");
    expect(workingService).toContain("assignedUsers");
    expect(workingService).toContain("pendingClaims");
    expect(workingService).toContain("pendingTrades");
    expect(workingService).toContain("where: { id: { in: assignedUserIds } }");
    expect(workingService).not.toContain("sendPush");
    expect(workingService).not.toContain("sendEmail");
  });

  it("ranks working-copy assignment candidates from the effective draft slot", () => {
    const scoreRoute = readFileSync(
      "src/app/api/shift-groups/[id]/working-copy/candidate-scores/route.ts",
      "utf8",
    );
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const picker = readFileSync("src/components/shift-detail/UserAvatarPicker.tsx", "utf8");
    const workingService = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");

    expect(scoreRoute).toContain('requirePermission(user.role, "shift", "manage")');
    expect(scoreRoute).toContain("getWorkingScheduleCandidateScores");
    expect(workingService).toContain("getCandidateScoresForTarget");
    expect(workingService).toContain("sportCode: group.event.sportCode");
    expect(workingService).toContain("workerTypeOverride");
    expect(editor).toContain("/working-copy/candidate-scores?");
    expect(editor).toContain("candidateScores=");
    expect(picker).toContain("candidateScores[b.id]?.score");
    expect(picker).toContain('className="h-72 max-h-[var(--radix-popover-content-available-height)]"');
  });

  it("keeps assigned conversion explicit and replacement-only", () => {
    const workingCopy = readFileSync("src/lib/schedule-working-copy.ts", "utf8");
    const workingService = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const publication = readFileSync("src/lib/services/schedule-publication.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");

    expect(workingCopy).toContain('type: z.literal("convertAndReplace")');
    expect(workingCopy).toContain("sourceAssignmentId: null");
    expect(workingService).toContain("Cancel the active trade before replacing this person.");
    expect(workingService).toContain("Unlink the assignment's booking before replacing this person.");
    expect(publication).toContain("explicitlyReplacingCurrentAssignment");
    expect(editor).toContain('type: "convertAndReplace"');
    expect(editor).toContain("Replace and convert to");
  });
});

/**
 * While a private working copy exists, the live relational schedule must not be
 * mutated by any legacy path. When these guards were absent, staff could add a
 * shift and assign someone through Event detail while a draft was open; the
 * draft never saw those rows, and publish then reported them as "history-bearing
 * slots" it refused to remove — an error the editor gave no way to resolve
 * because the offending slots were not visible in it. Pin every guarded path so
 * that class of desync cannot silently return.
 */
const retiredRoutes = [
  "src/app/api/shift-assignments/route.ts",
  "src/app/api/shifts/[id]/route.ts",
  "src/app/api/shift-groups/[id]/shifts/route.ts",
  "src/app/api/shift-groups/[id]/shifts/[shiftId]/route.ts",
  "src/app/api/shift-assignments/[id]/route.ts",
];

describe("working-copy mutation guard", () => {
  it.each(retiredRoutes)("retires live schedule mutations in %s", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("rejectRetiredLiveScheduleMutation");
  });

  it("guards every live assignment mutation in the assignment service", () => {
    const source = readFileSync("src/lib/services/shift-assignments.ts", "utf8");
    // Direct assign, swap, acknowledge, and decline all reach live rows.
    // (`removeAssignment` was deleted 2026-09-20 — the DELETE route is a 410 stub.)
    const guardCount = source.match(/assertNoWorkingCopy\(/g)?.length ?? 0;
    expect(guardCount).toBeGreaterThanOrEqual(5);
  });

  it("keeps reservation-backed assignment out of a group with an open draft", () => {
    const source = readFileSync("src/lib/services/reservation-schedule.ts", "utf8");
    expect(source).toContain("if (group.workingCopy) return null;");
  });

  it("rejects a live mutation with a recoverable 409, not a generic failure", () => {
    const guard = readFileSync("src/lib/schedule-working-copy-guard.ts", "utf8");
    expect(guard).toContain("new HttpError(409");
    expect(guard).toContain("Review or discard the private working schedule");
  });

  it("returns a deliberate 410 for retired live mutation routes", () => {
    const guard = readFileSync("src/lib/schedule-working-copy-guard.ts", "utf8");
    expect(guard).toContain("new HttpError(410");
    expect(guard).toContain("Open the Event and use its private working schedule editor");
  });

  // The draft snapshot is taken when the working copy row is created, so a shift
  // created after that timestamp was never in the draft. Publish must tell those
  // apart from slots the user actually removed, or it reports the wrong problem
  // and offers advice that cannot resolve it.
  it("separates post-draft drift from user removals before publishing", () => {
    const source = readFileSync("src/lib/services/schedule-publication.ts", "utf8");
    expect(source).toContain("const draftStartedAt = group.workingCopy.createdAt;");
    expect(source).toContain("shift.createdAt > draftStartedAt");
    // Drift short-circuits, so the removal check below only ever sees shifts
    // that predate the draft; an explicit partition is no longer needed.
    expect(source).toContain('code: "drifted_in"');
    expect(source).toContain("Refresh to pull them into this draft");
    // The publish query has to actually load both timestamps for that to work.
    expect(source).toContain("createdAt: true,");
  });

  // Live rebase is automatic once the working copy sees a newer published
  // version. Pin the route, service wiring, and editor polling together.
  it("automatically rebases a working schedule after live drift", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const service = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");

    expect(route).toContain("export const POST");
    expect(route).toContain("rebaseWorkingSchedule");
    expect(route).toContain('requirePermission(user.role, "shift", "manage")');
    expect(route).toContain("enforceRateLimit");
    expect(service).toContain("export async function rebaseWorkingSchedule");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("basePublishedVersion: group.publishedVersion");
    expect(editor).toContain("refreshFromLive");
    expect(editor).toContain("basePublishedVersion < latest.publishedVersion");
    expect(editor).toContain("formatNotificationCountdown");
    expect(editor).not.toContain("Refresh from live");
  });

  it("keeps the Staff/Admin publish-now override on the audited reconciliation path", () => {
    const service = readFileSync("src/lib/services/schedule-publication.ts", "utf8");
    const route = readFileSync("src/app/api/shift-groups/[id]/publish/route.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const workflow = readFileSync("src/workflows/pending-schedule-release.ts", "utf8");

    expect(service).toContain("export async function collectPublishBlockers");
    expect(service).toContain("problems block publishing this schedule");
    expect(service).toContain("findTimeConflict(");
    expect(route).toContain('requirePermission(user.role, "shift", "publish_now")');
    expect(route).toContain("publishShiftGroup(");
    expect(route).toContain("requireWorkingCopy: true");
    expect(editor).toContain("/publish");
    expect(workflow).toContain("publishShiftGroup(");
    expect(workflow).toContain("autoReleaseError");
  });

  it("shows position creation to Staff and Admins while preserving the API permission gate", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const crewRow = readFileSync("src/components/shift-detail/crew-row.tsx", "utf8");

    expect(route).toContain('requirePermission(user.role, "shift", "manage_positions")');
    expect(route).toContain('body.command.type === "adjustSlots" && body.command.delta === 1');
    expect(editor).toContain('const canManageSchedule = currentUser?.role === "ADMIN" || currentUser?.role === "STAFF"');
    expect(editor).toContain("action={canManageSchedule ? (");
    expect(editor).toContain("canManageSchedule && emptyAreas.length > 0");
    expect(editor).toContain("Apply correction now");
    expect(editor).toContain("canManageSchedule && data.hasWorkingCopy");
    expect(editor).toContain("canManageSchedule && showStudentCallButton && !data.allDay && data.schedule.slots.some");
    expect(crewRow).toContain("Add ${areaLabel(area)} ${label} position");
    const eventPage = readFileSync("src/app/(app)/events/[id]/page.tsx", "utf8");
    expect(eventPage).toContain("useCurrentUser");
    expect(eventPage).not.toContain('url: "/api/me"');
  });
});
