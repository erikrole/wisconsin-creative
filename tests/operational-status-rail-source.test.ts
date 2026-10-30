import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sourceForMigratedPage(page: string) {
  const files = page === "src/app/(app)/licenses/page.tsx"
    ? [page, "src/app/(app)/licenses/PhotoMechanicLicenses.tsx"]
    : [page];
  return files.map(source).join("\n");
}

describe("operational status rail source contract", () => {
  it("prioritizes exceptions, bounds the visible rail, and accounts for overflow", () => {
    const rail = source("src/components/OperationalStatusRail.tsx");

    expect(rail).toContain("const TONE_RANK");
    expect(rail).toContain("maxVisibleItems = 3");
    expect(rail).toContain("const visibleItems = prioritizedItems.slice(0, maxVisibleItems)");
    expect(rail).toContain("const hiddenCount = Math.max(0, prioritizedItems.length - visibleItems.length)");
    expect(rail).toContain("Show ${detailsLabel.toLowerCase()} and ${hiddenCount} more statuses");
    expect(rail).toContain("allClearLabel");
    expect(rail).toContain("tabular-nums");
    expect(rail).toContain("feed ?");
  });

  it("keeps route calculations outside the shared presentation contract", () => {
    const rail = source("src/components/OperationalStatusRail.tsx");
    const schedule = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
    const fixToday = source("src/app/(app)/operations/OperationsClient.tsx");
    const items = source("src/app/(app)/items/page.tsx");

    expect(rail).not.toContain("ScheduleQueue");
    expect(rail).not.toContain("AdminFixTodayQueue");
    expect(schedule).toContain("<OperationalStatusRail");
    expect(schedule).toContain("<ScheduleRecentActivity");
    expect(schedule).toContain("feed={(");
    expect(fixToday).toContain("<OperationalStatusRail");
    expect(fixToday).toContain("const railItems: OperationalStatusRailItem[]");
    // Items moved to status tabs with counts; the rail stays for operational queues.
    expect(items).not.toContain("<OperationalStatusRail");
    expect(items).toContain('<TabsList className="overflow-x-auto scrollbar-hide" aria-label="Item status">');
    expect(items).toContain('filters.setStatusFilter(new Set(value === "all" ? [] : [value]))');
  });

  it("migrates page-level operational summaries without converting analytical reports", () => {
    const migratedPages = [
      "src/app/(app)/operations/OperationsClient.tsx",
      "src/app/(app)/licenses/page.tsx",
      "src/app/(app)/staff/onboarding-status/page.tsx",
    ];

    for (const page of migratedPages) {
      expect(sourceForMigratedPage(page), page).toContain("<OperationalStatusRail");
    }

    expect(existsSync("src/app/(app)/dashboard/stat-card.tsx")).toBe(false);
    // The inbox count lives on the Unread tab, so Notifications has no rail.
    expect(source("src/app/(app)/notifications/page.tsx")).not.toContain("<OperationalStatusRail");
    // Each kit row carries its own Ready, Out or Empty status, so Kits has no rail.
    expect(source("src/app/(app)/kits/page.tsx")).not.toContain("<OperationalStatusRail");
    expect(source("src/app/(app)/reports/checkouts/page.tsx")).not.toContain("<OperationalStatusRail");
    expect(source("src/app/(app)/import/_components/ImportPreviewStep.tsx")).not.toContain("<OperationalStatusRail");
  });

  it("preserves filter selection in rail details where the summary is a facet", () => {
    const notifications = source("src/app/(app)/notifications/page.tsx");
    const onboarding = source("src/app/(app)/staff/onboarding-status/page.tsx");
    const allowedEmails = source("src/app/(app)/settings/allowed-emails/page.tsx");

    expect(notifications).toContain('value={unreadOnly ? "unread" : "all"}');
    expect(onboarding).toContain('ariaPressed={statusFilter === "stale"}');
    // Registration access filters with a segmented control instead of a rail.
    expect(allowedEmails).toContain("aria-checked={selected}");
  });
});
