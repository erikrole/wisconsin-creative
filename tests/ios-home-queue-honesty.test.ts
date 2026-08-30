import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Home action queue honesty", () => {
  const home = source("ios/Wisconsin/Views/HomeView.swift");

  it("never truncates overdue", () => {
    // Every other lane can hide its tail behind the overflow row. Dropping the
    // fourth overdue checkout hid the most urgent thing on the screen, and the
    // stat strip above it still counted the one that was missing.
    expect(home).toContain("let overdue = overdueBookings.map {");
    expect(home).not.toContain("overdueBookings.prefix(3)");
  });

  it("says what the per-lane caps left out", () => {
    expect(home).toContain("private func hiddenCounts() -> (gear: Int, shifts: Int)");
    expect(home).toContain("private struct QueueOverflowRow: View");
    expect(home).toContain("if hidden.gear + hidden.shifts > 0 {");
    // The row names where the rest actually is rather than implying one tab.
    expect(home).toContain('return "\\(gear) more in Bookings"');
    expect(home).toContain('return "\\(gear + shifts) more in Bookings and Schedule"');
    expect(home).toContain("gear == 0 ? openSchedule : openBookings");
    // Still a real control: 44pt and its own combined label. Standard button
    // feedback owns selection haptics; the app-wide mute preference is
    // applied only to custom feedback paths.
    expect(home).toContain("minHeight: 44");
    expect(home).toContain("accessibilityLabel(label)");
  });

  it("only claims all-clear when the whole screen is clear", () => {
    // `||` let "You're all set" render directly above a populated Drafts card
    // whenever the personal queue happened to be empty.
    expect(home).toContain("} else if isAllEmpty(dash) && !hasStaffFollowUp(dash) {");
    expect(home).not.toContain("isAllEmpty(dash) || !hasStaffFollowUp(dash)");
    expect(home).toContain("!dash.flaggedItems.isEmpty || !dash.lostBulkUnits.isEmpty || !dash.drafts.isEmpty");
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
