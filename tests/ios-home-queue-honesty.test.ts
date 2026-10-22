import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Home action queue honesty", () => {
  const home = source("ios/Wisconsin/Views/HomeView.swift");
  const sections = source("ios/Wisconsin/Views/Home/HomeSections.swift");
  const model = source("ios/Wisconsin/Views/Home/HomeModel.swift");

  it("never hides a critical row behind show more", () => {
    // Dropping the fourth overdue checkout hid the most urgent thing on the
    // screen with no affordance at all. Only non-critical rows are capped.
    expect(sections).toContain("$0.offset < limit || $0.element.tone == .critical");
    expect(sections).toContain('Text("Show \\(hidden) more")');
    expect(model).toContain("title: plural(hidden, \"more overdue checkout\")");
  });

  it("only claims all-clear when the whole screen is clear", () => {
    // Staff follow-ups (drafts, flags, lost units) are attention rows, so an
    // all-clear state can only appear when none of them exist.
    expect(sections).toContain("let everythingQuiet = attention.isEmpty && upNext.isEmpty");
    expect(model).toContain("for d in dash.drafts");
    expect(model).toContain("for f in dash.flaggedItems where !f.isMaintenanceFlag");
    expect(home).not.toContain("isAllEmpty(dash) || !hasStaffFollowUp(dash)");
  });

  it("says what is next when everything is clear", () => {
    expect(model).toContain("static func nextUp(dash: DashboardData");
    expect(sections).toContain("AllClearEmptyState(next: HomeModel.nextUp(dash: dash, now: now)");
  });

  it("keeps the staff sections collapsed until asked", () => {
    expect(sections).toContain("private struct CollapsibleSection<Content: View>: View");
    expect(sections).toContain("@State private var expanded: Set<String> = HomeDashboardList.initiallyExpanded");
    expect(sections).toContain('accessibilityValue(isOpen ? "Expanded" : "Collapsed")');
  });

  it("keeps Home stats personally scoped on the server", () => {
    // The Home audit called these team-wide. `scope=ios-home` sets
    // `isPersonalOnly`, so they are the caller's own counts -- pinned here so a
    // future scope refactor cannot quietly put team totals over a personal queue.
    const route = source("src/app/api/dashboard/route.ts");
    expect(route).toContain('const isIosHomeScope = scope === "ios-home"');
    expect(route).toContain("const isPersonalOnly = isIosHomeScope || isCollaborator;");
    expect(route).toContain("isPersonalOnly ? counts.myOverdue : counts.totalOverdue");
    expect(route).toContain("isPersonalOnly ? counts.myDueToday : counts.dueToday");
  });
});
