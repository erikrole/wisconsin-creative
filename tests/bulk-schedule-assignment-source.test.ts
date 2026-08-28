import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("bulk schedule assignment contracts", () => {
  it("keeps the mutation behind the working-copy and exact-version release boundary", () => {
    const service = read("src/lib/services/bulk-schedule-assignment.ts");
    const applyRoute = read("src/app/api/schedule/bulk-assignment/apply/route.ts");

    expect(service).toContain("scheduleBulkAssignment");
    expect(service).toContain("isolationLevel: Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain('source: "AUTO_FILL"');
    expect(service).toContain("preview.fingerprint !== input.fingerprint");
    expect(service).toContain("enqueueRelease({ shiftGroupId, version: 1, now, batchId })");
    expect(applyRoute).toContain('requirePermission(user.role, "shift", "manage")');
    expect(applyRoute).toContain("bulkAssignmentApplySchema");
  });

  it("consolidates worker notifications and gives them a My Shifts deep link", () => {
    const notifications = read("src/lib/services/notifications.ts");
    const policy = read("src/lib/services/schedule-notification-policy.ts");
    const workflow = read("src/workflows/pending-schedule-release.ts");

    expect(notifications).toContain('type: "shift_schedule_bulk_assigned"');
    expect(notifications).toContain('const body = "Click to review your upcoming shifts"');
    expect(notifications).toContain("scheduleMyShiftsNotificationPayload");
    expect(notifications).toContain("schedule_bulk_assignment:${batch.id}:${userId}");
    expect(policy).toContain('target: "schedule"');
    expect(policy).toContain('myShifts: "true"');
    expect(policy).toContain("startDate");
    expect(policy).toContain("endDate");
    expect(workflow).toContain('status: "RELEASED"');
    expect(workflow).toContain("recordBulkScheduleReleaseOutcome");
    expect(workflow).toContain("notifyPublishedShiftGroupWorkers");
    expect(workflow.indexOf('if (batchId)')).toBeLessThan(workflow.indexOf("notifyPublishedShiftGroupWorkers(shiftGroupId"));
  });

  it("keeps the UI preview-first and supports the recipient filter deep link", () => {
    const dialog = read("src/components/schedule/AutoAssignDialog.tsx");
    const assignPage = read("src/app/(app)/schedule/assign/_components/AssignPageClient.tsx");
    const scheduleHook = read("src/hooks/use-schedule-data.ts");

    expect(dialog).toContain("review every proposed worker, then apply");
    expect(dialog).toContain("/api/schedule/bulk-assignment/preview");
    expect(dialog).toContain("/api/schedule/bulk-assignment/apply");
    expect(assignPage).toContain("AutoAssignDialog");
    expect(scheduleHook).toContain('query.get("myShifts") === "true"');
    expect(scheduleHook).toContain('query.get("startDate")');
    expect(scheduleHook).toContain('query.get("endDate")');
    expect(scheduleHook).toContain("dateRange");
  });

  it("gives staff one Auto assign entry point on the Schedule page", () => {
    const schedulePage = read("src/app/(app)/schedule/page.tsx");

    // Gated on the staff/admin branch, not rendered for students.
    expect(schedulePage).toContain("AutoAssignDialog");
    expect(schedulePage).toContain("Auto assign");
    expect(schedulePage).toContain("{isStaff && (\n        <AutoAssignDialog");
    expect(schedulePage).toContain("initialSportCodes={data.filters.sportFilter");
  });

  it("scopes a batch by sports, period, and scheduling class from one shared engine", () => {
    const types = read("src/lib/bulk-schedule-assignment-types.ts");
    const service = read("src/lib/services/bulk-schedule-assignment.ts");
    const dialog = read("src/components/schedule/AutoAssignDialog.tsx");

    expect(types).toContain("sportCodes");
    expect(types).toContain("BULK_ASSIGNMENT_WORKER_SCOPES");
    expect(types).toContain("summarizeAssignmentPeople");
    // The worker scope narrows which slots are touched; it never lets a worker
    // take a slot of the other scheduling class.
    expect(service).toContain("scope.workerScope !== \"ALL\" && slot.workerType !== scope.workerScope");
    expect(service).toContain("sportCode: { in: scope.sportCodes }");
    expect(service).toContain("shiftWorkerTypeForProfile(candidate) !== slot.workerType");
    expect(dialog).toContain("resolveAssignmentWindow");
    expect(dialog).toContain("summarizeAssignmentPeople(selectedProposals)");
  });

  it("draws purely from the sport roster in both auto-assign paths", () => {
    const eligibility = read("src/lib/schedule-assignment-eligibility.ts");
    const bulk = read("src/lib/services/bulk-schedule-assignment.ts");
    const autoFill = read("src/lib/services/auto-fill-preview.ts");

    // One rule, two views: the scoring signal for previews, the roster rows for
    // the write that re-validates against live data.
    expect(eligibility).toContain("isSportRosterEligible");
    expect(eligibility).toContain("isOnSportRoster");
    expect(bulk).toContain("if (!isSportRosterEligible(score, state.event.sportCode)) return false;");
    expect(bulk).toContain("isOnSportRoster(user.sportAssignments, group.event.sportCode)");
    expect(autoFill).toContain("if (!isSportRosterEligible(score, eventSportCode)) return false;");
  });

  it("never half-crews an event silently", () => {
    const types = read("src/lib/bulk-schedule-assignment-types.ts");
    const service = read("src/lib/services/bulk-schedule-assignment.ts");
    const dialog = read("src/components/schedule/AutoAssignDialog.tsx");

    expect(types).toContain("requireFullCrew");
    expect(types).toContain("unfilledSlots");
    expect(service).toContain("scope.requireFullCrew && proposals.length < state.openSlots.length");
    expect(service).toContain('reasonCode: "partial_crew_blocked"');
    expect(service).toContain("eventsPartiallyCrewed");
    expect(service).toContain("eventsPendingChanges");
    expect(dialog).toContain("Full crews only");
    expect(dialog).toContain("would release short a position");
    expect(dialog).toContain("skipped for unreleased staff changes");
  });

  it("keeps a staged batch cancellable until its release fires", () => {
    const batches = read("src/lib/services/bulk-assignment-batches.ts");
    const cancelRoute = read("src/app/api/schedule/bulk-assignment/batches/[id]/cancel/route.ts");
    const panel = read("src/components/schedule/PendingAssignmentBatches.tsx");

    expect(batches).toContain("BULK_ASSIGNMENT_CANCEL_ACTION");
    // Only the version this batch wrote is discarded; a later staff edit wins.
    expect(batches).toContain("where: { shiftGroupId: item.shiftGroupId, version: item.expectedVersion }");
    expect(batches).toContain("isolationLevel: Prisma.TransactionIsolationLevel.Serializable");
    expect(batches).toContain("finalizeBulkScheduleAssignment(batchId)");
    expect(cancelRoute).toContain('requirePermission(user.role, "shift", "manage")');
    expect(panel).toContain("Releases to workers in");
  });

  it("blocks approved time off for every scheduling class", () => {
    const scoring = read("src/lib/services/candidate-scoring.ts");
    const service = read("src/lib/services/bulk-schedule-assignment.ts");

    expect(scoring).toContain("const availability = evaluateAvailabilityPreferences(candidate.availabilityBlocks, targetWindow);");
    expect(scoring).not.toContain('candidateWorkerType === "ST"');
    expect(service).toContain("const availability = evaluateAvailabilityPreferences(user.availabilityBlocks, window);");
    expect(service).not.toContain("if (slot.workerType === ShiftWorkerType.ST) {");
  });

  it("honors each sport's auto-assign policy in both engines and at the write", () => {
    const bulk = read("src/lib/services/bulk-schedule-assignment.ts");
    const autoFill = read("src/lib/services/auto-fill-preview.ts");
    const policy = read("src/lib/sport-auto-assign-policy.ts");

    expect(policy).toContain("FULL_CREW");
    expect(policy).toContain("STAFF_ONLY");
    expect(policy).toContain("HOLD");
    // A held sport is skipped before any slot work, ahead of the pending-copy
    // branch, so the reason given is the policy rather than a stale edit.
    expect(bulk).toContain("if (policy === SportAutoAssignPolicy.HOLD) {");
    expect(bulk.indexOf("SportAutoAssignPolicy.HOLD")).toBeLessThan(bulk.indexOf("if (group.workingCopy) {"));
    expect(bulk).toContain('reasonCode: "sport_policy_hold"');
    // A student slot on a STAFF_ONLY sport is out of scope, not an unfilled gap.
    expect(bulk).toContain("if (!policyAllowsWorkerType(policy, slot.workerType)) return false;");
    expect(bulk).toContain("if (!policyAllowsWorkerType(groupPolicy, slot.workerType)) {");
    expect(bulk).toContain("was put on hold for auto assignment");
    expect(autoFill).toContain("policyAllowsWorkerType(policy, shift.workerType");
  });

  it("sets policy and roster together, sport by sport", () => {
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");
    const setup = read("src/lib/services/sport-setup.ts");
    const route = read("src/app/api/schedule/sport-setup/route.ts");
    const settings = read("src/app/(app)/settings/sports/page.tsx");

    expect(setup).toContain("PRIORITY_SPORT_CODES");
    expect(setup).toContain("visibleActiveUserWhere");
    expect(route).toContain('requirePermission(user.role, "sport_config", "manage")');
    expect(route).toContain("sport_auto_assign_policy_set");
    // Reuses the existing roster endpoints rather than adding a second writer.
    expect(wizard).toContain("/api/sport-configs/${sport.sportCode}/roster");
    expect(wizard).toContain("Sport {index + 1} of {total}");
    expect(settings).toContain("SportSetupWizard");
  });

  it("edits the travel roster in the wizard through the existing roster writer", () => {
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");
    const setup = read("src/lib/services/sport-setup.ts");
    const travelCard = read("src/app/(app)/events/[id]/_components/EventTravelCard.tsx");

    expect(setup).toContain("defaultTraveler");
    // Same PATCH the Event travel card uses -- one writer for travel state.
    expect(wizard).toContain('method: "PATCH"');
    expect(wizard).toContain("defaultTraveler: next");
    expect(travelCard).toContain("defaultTraveler: !entry.defaultTraveler");
    // Same plane idiom, so travel state reads the same in both places.
    expect(wizard).toContain("Travel roster");
    // One symbol for travel across both surfaces.
    expect(wizard).toContain("<Plane className=");
    expect(travelCard).toContain("<Plane className=");
    expect(wizard).not.toContain("<Star ");
    expect(travelCard).not.toContain("<Star ");
    expect(wizard).toContain("aria-pressed={member.defaultTraveler}");
    expect(wizard).toContain("fill={member.defaultTraveler ? \"currentColor\" : \"none\"}");
  });

  it("matches one sport's setup onto another without deleting a roster", () => {
    const setup = read("src/lib/services/sport-setup.ts");
    const route = read("src/app/api/schedule/sport-setup/match/route.ts");
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");

    expect(setup).toContain("matchSportSetup");
    expect(setup).toContain("isolationLevel: Prisma.TransactionIsolationLevel.Serializable");
    // Additive by design: matching copies the missing people and never removes
    // anyone already on the target roster.
    expect(setup).toContain("const missing = sourceMembers.filter((member) => !existing.has(member.userId));");
    expect(setup).not.toContain("deleteMany");
    expect(setup).toContain("defaultTraveler: member.defaultTraveler");
    expect(setup).toContain('action: "sport_setup_matched"');
    expect(route).toContain('requirePermission(user.role, "student_sport", "manage")');
    expect(wizard).toContain("Match another sport");
    expect(wizard).toContain("Nobody already here is removed");
  });

  it("makes the wizard the settings page's source for policy, roster, and travel", () => {
    const settings = read("src/app/(app)/settings/sports/page.tsx");
    const table = read("src/app/(app)/settings/sports/ShiftConfigTable.tsx");

    // Same endpoint the wizard writes through, so the two cannot drift.
    expect(settings).toContain('url: "/api/schedule/sport-setup"');
    expect(settings).toContain("reloadSportSetup()");
    expect(settings).toContain("startAtSportCode={wizardSportCode}");
    expect(table).toContain("SPORT_AUTO_ASSIGN_POLICY_LABELS");
    expect(table).toContain("on the roster");
    expect(table).toContain("onOpenSetup(code)");
  });

  it("says what happens on apply, and lets a sport be skipped", () => {
    const dialog = read("src/components/schedule/AutoAssignDialog.tsx");
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");

    expect(dialog).toContain("ten minutes to cancel before workers are notified");
    expect(dialog).toContain("a sport on hold is skipped whatever you pick here");
    expect(wizard).toContain("take effect the next time Auto assign runs");
    expect(wizard).toContain("Skip leaves a sport exactly as it is");
    expect(wizard).toContain("\n                Skip\n              </Button>");
  });

  it("does not spend the event cap on sports that can never produce a proposal", () => {
    const service = read("src/lib/services/bulk-schedule-assignment.ts");

    // Policies are resolved before the scope query so held sports can be left out.
    expect(service.indexOf("loadSportAutoAssignPolicies(scope.sportCodes")).toBeLessThan(
      service.indexOf("loadScopeEvents(scope, heldCodes)"),
    );
    expect(service).toContain("heldSportFilter");
    // A bare notIn would drop non-sport events, whose sportCode is null.
    expect(service).toContain("{ OR: [{ sportCode: null }, { sportCode: { notIn: heldCodes } }] }");
    // The count survives even though the rows are never loaded.
    expect(service).toContain("db.calendarEvent.count({ where: { ...window, sportCode: { in: inScopeHeldCodes } } })");
    expect(service).toContain("eventsOnHold: heldEventCount");
  });

  it("rate-limits every auto-assign endpoint, reads included", () => {
    const routes = [
      "src/app/api/schedule/sport-setup/route.ts",
      "src/app/api/schedule/sport-setup/match/route.ts",
      "src/app/api/schedule/sport-roster/route.ts",
      "src/app/api/schedule/bulk-assignment/batches/route.ts",
      "src/app/api/schedule/bulk-assignment/batches/[id]/cancel/route.ts",
      "src/app/api/schedule/bulk-assignment/preview/route.ts",
      "src/app/api/schedule/bulk-assignment/apply/route.ts",
    ];
    for (const route of routes) {
      expect(read(route), `${route} is missing a rate limit`).toContain("enforceRateLimit");
    }
  });

  it("audits every roster mutation, travel included", () => {
    const roster = read("src/app/api/sport-configs/[sportCode]/roster/route.ts");

    expect(roster).toContain('action: "roster_added"');
    expect(roster).toContain('action: "roster_bulk_added"');
    expect(roster).toContain('action: "roster_removed"');
    // Travel used to be the one roster change that left no trail.
    expect(roster).toContain('action: "roster_travel_set"');
  });

  it("keeps an optimistic failure from claiming a sport was saved", () => {
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");

    expect(wizard).toContain("function revertSport");
    expect(wizard).toContain("Undo an optimistic change without claiming the sport was updated");
    expect(wizard).toContain("revertSport(sport.sportCode, (entry) => ({ ...entry, policy: previous }));");
    expect(wizard).toContain("applyTravel(!next, false);");
  });

  it("crews away games from the travel roster in both engines and at the write", () => {
    const bulk = read("src/lib/services/bulk-schedule-assignment.ts");
    const autoFill = read("src/lib/services/auto-fill-preview.ts");
    const scoring = read("src/lib/services/candidate-scoring.ts");

    // Travel state has to reach the candidate snapshot to be gated on.
    expect(scoring).toContain("sportAssignments: { select: { sportCode: true, defaultTraveler: true } }");
    expect(bulk).toContain("isTravelEligible(candidate.sportAssignments, state.event.sportCode, state.event.isHome");
    expect(bulk).toContain("isTravelEligible(\n          user.sportAssignments,");
    expect(bulk).toContain('reasonCode = "no_travel_roster"');
    expect(bulk).toContain("no longer on the travel roster for an away game");
    expect(autoFill).toContain("isTravelEligible(user.sportAssignments ?? [], eventSportCode, eventIsHome");
    // Only away events pay for the extra lookup.
    expect(bulk).toContain("groups.filter((group) => group.event.isHome === false)");
  });

  it("shows the sport roster behind a scope before the preview is built", () => {
    const roster = read("src/lib/services/sport-roster-preview.ts");
    const route = read("src/app/api/schedule/sport-roster/route.ts");
    const preview = read("src/components/schedule/SportRosterPreview.tsx");

    expect(roster).toContain("visibleActiveUserWhere");
    expect(roster).toContain("emptySportCodes");
    expect(route).toContain('requirePermission(user.role, "student_sport", "view")');
    expect(preview).toContain("Nobody assigned");
    expect(preview).toContain("only proposes people on a sport");
    expect(preview).toContain("SPORT_AUTO_ASSIGN_POLICY_LABELS");
    expect(roster).toContain("heldSportCodes");
    expect(preview).toContain("onEditSport(sport.sportCode)");
  });
});
