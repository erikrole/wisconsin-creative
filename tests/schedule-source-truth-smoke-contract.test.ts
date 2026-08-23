import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("schedule source-of-truth and browser smoke contracts", () => {
  it("keeps the authenticated launch browser gate configured and scoped", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    const config = source("playwright.config.ts");
    const authSetup = source("tests/e2e/auth.setup.ts");
    const launchSmoke = source("tests/e2e/launch-smoke.spec.ts");

    expect(existsSync("playwright.config.ts")).toBe(true);
    expect(dependencyNames.has("@playwright/test")).toBe(true);
    expect(packageJson.scripts?.["test:e2e:smoke"]).toBe("playwright test");
    expect(config).toContain('name: "desktop-chromium"');
    expect(config).toContain('name: "narrow-mobile-chromium"');
    expect(config).toContain('trace: "retain-on-failure"');
    expect(config).toContain('screenshot: "only-on-failure"');
    expect(config).toContain("resolveSmokeSafety");
    const safety = source("tests/e2e/smoke-safety.ts");
    expect(safety).toContain("PLAYWRIGHT_RELEASE");
    expect(safety).toContain('env.CI !== undefined');
    expect(safety).toContain('PLAYWRIGHT_TARGET_ISOLATED !== "1"');
    expect(safety).toContain('"wisconsincreative.com"');
    expect(safety).toContain("PLAYWRIGHT_PRODUCTION_HOSTS");
    expect(authSetup).toContain('page.goto("/login")');
    expect(authSetup).toContain("PLAYWRIGHT_EMAIL");
    expect(authSetup).toContain("PLAYWRIGHT_PASSWORD");
    expect(authSetup).toContain("storageState({ path: AUTH_FILE })");

    for (const route of [
      'path: "/"',
      'path: "/bookings"',
      'path: "/items"',
      'path: "/search"',
      'path: "/schedule"',
      'path: "/settings"',
      'path: "/settings/profile"',
    ]) {
      expect(launchSmoke).toContain(route);
    }
    expect(launchSmoke).toContain("a direct role-restricted Settings URL fails closed");
    expect(launchSmoke).toContain("Search keeps available results visible");
    expect(launchSmoke).toContain("Items names partial bootstrap failures");
    expect(launchSmoke).toContain("Dashboard preserves trusted counts through failure");
  });

  it("keeps readiness cards and Schedule queues URL-backed", () => {
    const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
    const changePreview = source("src/app/(app)/schedule/_components/ScheduleChangePreview.tsx");
    const hook = source("src/hooks/use-schedule-data.ts");
    const page = source("src/app/(app)/schedule/page.tsx");

    for (const queue of [
      "needs-staffing",
      "my-calls-today",
      "trade-approval",
      "pending-requests",
      "conflicts",
      "gear-gaps",
      "data-quality",
      "stale-source",
    ]) {
      expect(readiness).toContain(`onShowQueue("${queue}")`);
    }

    expect(hook).toContain('searchParams.get("queue")');
    expect(hook).toContain('params.set("queue", queue)');
    expect(hook).toContain("filterEntriesForScheduleQueue");
    expect(page).toContain('initialStatusFilter={data.filters.queue === "trade-approval" ? "CLAIMED" : undefined}');
    expect(readiness).toContain("<ScheduleChangePreview");
    expect(readiness).toContain('setPreviewFilter("assignee")');
    expect(changePreview).toContain("Open event");
    expect(changePreview).toContain("Working copy");
  });

  it("keeps automation review cards read-only and routed to existing work surfaces", () => {
    const digest = source("src/app/(app)/schedule/_components/ScheduleAutomationDigest.tsx");
    const route = source("src/app/api/schedule/automation/route.ts");
    const service = source("src/lib/services/schedule-automation.ts");

    expect(digest).toContain("Suggestions only");
    expect(digest).toContain("Nothing here changes staffing, publishing, trades, or notifications by itself.");
    expect(digest).toContain("onShowQueue(action.queue)");
    expect(digest).toContain("onOpenTradeBoard()");
    expect(digest).toContain("href={action?.href}");
    expect(route).toContain("export const GET");
    expect(route).not.toContain("export const POST");
    expect(route).not.toContain("export const PATCH");
    expect(route).not.toContain("export const DELETE");
    expect(service).toContain("action:");
    expect(service).toContain('firstHref(autoFillCandidateEventIds)');
    expect(service).not.toContain('href: "/schedule/assign"');
  });

  it("keeps working-copy assignment scoring and review-first coverage without surfacing template review", () => {
    const assignmentCell = source("src/app/(app)/schedule/assign/_components/AssignmentCell.tsx");
    const picker = source("src/components/shift-detail/UserAvatarPicker.tsx");
    const eventCrew = source("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx");
    const shiftPanel = source("src/components/ShiftDetailPanel.tsx");
    const workingEditor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");

    expect(assignmentCell).not.toContain("candidate-scores");
    expect(assignmentCell).not.toContain("fetch(");
    expect(workingEditor).toContain("/working-copy/candidate-scores?");
    for (const label of ["Recommended", "Good fit", "Warning", "Overloaded"]) {
      expect(picker).toContain(label);
    }
    expect(picker).toContain("candidateScores");
    expect(picker).toContain("Scoring candidates");

    expect(eventCrew).toContain("<WorkingCrewEditor");
    expect(eventCrew).not.toContain("/auto-assign/preview");
    expect(eventCrew).not.toContain("Apply recommended assignments");
    expect(shiftPanel).toContain("Review suggested assignments before applying them.");
    expect(eventCrew).toContain("rowCallWindow");
    // One table for every role means one call-time control, staff-editable via
    // rowCallTarget and read-only for everyone else.
    expect(eventCrew.match(/<CallWindowEditor/g)?.length).toBe(1);
    expect(eventCrew).toContain('variant="bare"');
    expect(eventCrew).not.toContain("const rowCallTarget");

    expect(eventCrew).not.toContain("CrewTemplateReviewButton");
    expect(shiftPanel).not.toContain("CrewTemplateReviewButton");
    expect(eventCrew).not.toContain("Review template");
    expect(shiftPanel).not.toContain("Review template");
  });

  it("keeps timed release, Open Work, Event detail gear readiness, and change history visible", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const eventCrew = source("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx");
    const editor = source("src/app/(app)/schedule/_components/WorkingCrewEditor.tsx");
    const release = source("src/lib/schedule-release.ts");
    const releaseRoute = source("src/app/api/shift-groups/[id]/publish/route.ts");
    const tradeBoard = source("src/components/TradeBoard.tsx");

    expect(editor).toContain("formatScheduleReleaseCountdown");
    expect(release).toContain("notified in");
    expect(editor).not.toContain("Pending changes");
    expect(editor).not.toContain("Releases at");
    expect(editor).toContain("Revert changes");
    expect(editor).not.toContain("/publish");
    expect(eventCrew).not.toContain("/acknowledge");
    expect(releaseRoute).toContain("new HttpError(410");

    expect(tradeBoard).toContain("OpenWorkShift");
    expect(tradeBoard).toContain("/api/schedule/open-work");
    expect(tradeBoard).toContain("Claim shift");
    expect(tradeBoard).toContain("Request sent for staff approval");

    expect(listView).not.toContain("Reserve gear");
    expect(listView).not.toContain("/reservations/new?");
    // Gear readiness is a card-level concern now, not a per-crew-row badge.
    expect(eventCrew).toContain("Missing Gear (");
    expect(eventCrew).toContain("Reserve gear");
    for (const label of ["Assignment gear", "Event reservation", "Pickup ready"]) {
      expect(eventCrew).not.toContain(label);
    }
    expect(eventCrew).not.toContain("type: \"slot\", id: shift.id");

    expect(listView).not.toContain("Review changes");
    expect(listView).not.toContain("Unpublished changes");
    expect(listView).not.toContain("Changed recently");
    expect(eventCrew).toContain("Recent schedule changes");
    expect(eventCrew).toContain("Needs review");
  });

  it("keeps Schedule list triage dense, grouped, and actionable across viewport sizes", () => {
    const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
    const mobile = listView.slice(
      listView.indexOf("Mobile: card list"),
      listView.indexOf("<Dialog"),
    );

    expect(listView).toContain("EVENT_GRID_CLASS");
    expect(listView).toContain("grid-cols-[44px_72px_minmax(180px,1fr)_80px_minmax(100px,140px)_136px_40px]");
    expect(listView).toContain("const openCount =");
    expect(listView).toContain("Manage crew");
    expect(listView).toContain("Set up crew");
    expect(listView).not.toContain("Assign {openCount}");
    expect(listView).toContain('weekday: "short"');
    expect(listView).toContain('month: "short"');
    expect(listView).toContain('day: "numeric"');
    expect(listView).not.toContain('text-[22px]');
    expect(mobile).toContain("groupedEntries.map");
    expect(mobile).toContain("groupEntries.map");
    expect(mobile).not.toContain("filteredEntries.map");
    expect(mobile).toContain("<CrewRowActions");
    expect(listView).toContain("Hide event");
    expect(mobile).toContain("onHideEvent(entry.id)");
    expect(mobile).toContain("hidingEventIds?.has(entry.id)");
    expect(listView).toContain('"group/row border-l-[3px] transition-colors"');
    expect(mobile).toContain('"relative border-b border-l-[3px] border-border/50 last:border-b-0"');
    expect(listView).toContain("venueTone.railClass");
  });

  it("keeps active Schedule filters visible and partial health failures out of the all-clear state", () => {
    const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
    const readiness = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");

    expect(filters).toContain("const menuFilterCount = [");
    expect(filters).toContain('label="Sport"');
    expect(filters).toContain("options={sportOptions}");
    expect(filters).toContain("<OperationalActiveFilterChips filters={activeFilters} />");
    expect(filters).toContain("{menuFilterCount}");
    expect(filters).not.toContain('className="w-72 p-3">\n            <div className="flex flex-col gap-3">\n              <FilterChip\n                label="Sport"');

    expect(readiness).toContain('label: "Synced calendar"');
    expect(readiness).toContain('label: "Assignee changes"');
    expect(readiness).toContain("value: sourceNeedsAttention || healthWarnings > 0 ? \"Check\"");
    expect(readiness).toContain("No recent schedule activity");
    expect(readiness).toContain("<ScheduleSourceStatus signal={sourceSignal} />");
    expect(readiness).not.toContain('label: "Next call"');
  });

  it("keeps event editing language clear for type, pickup location, and calendar venue", () => {
    const eventDetail = source("src/app/(app)/events/[id]/page.tsx");
    const newEventSheet = source("src/app/(app)/schedule/_components/NewEventSheet.tsx");
    const patchRoute = source("src/app/api/calendar-events/[id]/route.ts");
    const syncService = source("src/lib/services/calendar-sync.ts");

    for (const file of [eventDetail, newEventSheet]) {
      expect(file).toContain("Event type");
      expect(file).toContain("Non-game");
      expect(file).toContain("Pickup location");
    }

    expect(eventDetail).toContain("Event venue from calendar");
    expect(eventDetail).toContain("if (!event.source)");
    expect(eventDetail).toContain("Boolean(event.source) &&");
    expect(eventDetail).toContain("opponentDraft");
    expect(eventDetail).toContain("sportCodeDraft");
    expect(eventDetail).toContain("body.eventType = eventTypeDraft");
    expect(eventDetail).toContain('sportCodeDraft === "__none__"');
    expect(eventDetail).toContain("Date and time");
    expect(eventDetail).toContain("body.startsAt = startsAt");
    expect(eventDetail).toContain("Existing gear reservation windows stay unchanged");
    expect(newEventSheet).toContain("eventType,");
    expect(newEventSheet).toContain("Sport is required for a game event");
    expect(newEventSheet).toContain("Opponent is required for a game event");
    expect(patchRoute).toContain("opponent: z.string().max(120).nullable().optional()");
    expect(patchRoute).toContain("isHomeFromVenueTone(body.eventType)");
    expect(patchRoute).toContain("patch.isHomeLocked = true");
    expect(patchRoute).toContain("Imported event times are controlled by their calendar source");
    expect(patchRoute).toContain("shiftManualEventScheduleTx");
    expect(syncService).toContain("data.sportCode = existing.sportCode");
    expect(syncService).toContain("data.opponent = existing.opponent");
  });

});
