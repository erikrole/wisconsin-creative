import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("keeps pending edits private and starts the exact-version release timer before saving", () => {
    const route = readFileSync("src/app/api/shift-groups/[id]/working-copy/route.ts", "utf8");
    const editor = readFileSync("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx", "utf8");
    const workingService = readFileSync("src/lib/services/schedule-working-copy.ts", "utf8");
    const release = readFileSync("src/lib/schedule-release.ts", "utf8");

    expect(editor).toContain("/working-copy");
    expect(editor).not.toContain("/publish");
    expect(editor).toContain("formatScheduleReleaseCountdown");
    expect(release).toContain("notified in");
    expect(route).toContain("enqueuePendingScheduleRelease");
    expect(route).toContain("getWorkingScheduleEventEndsAt");
    expect(route).toContain("const eventHasEnded");
    expect(route).toContain("const autoRelease = eventHasEnded");
    expect(route).toContain("data.workingVersion,\n      user.role,\n      { clearNotificationPending: true }");
    expect(route).toContain("badges.onShiftsWorked({ userId }, { notify: false })");
    expect(route.indexOf("await enqueuePendingScheduleRelease")).toBeLessThan(route.indexOf("await mutateWorkingSchedule"));
    expect(route).toContain("version: body.expectedVersion + 1");
    expect(editor).toContain('type: "setCallWindow"');
    expect(editor).toContain('type: "setCallWindowForAll"');
    expect(editor).toContain("Student call time");
    expect(editor).toContain("Staff and collaborators do not have a call time");
    expect(editor).toContain("data?.assignedUsers");
    expect(workingService).toContain("assignedUsers");
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
