import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function sourceForMigratedPage(page: string) {
  const files = page === "src/app/(app)/licenses/page.tsx"
    ? [page, "src/app/(app)/licenses/PhotoMechanicLicenses.tsx"]
    : [page];
  return files.map(source).join("\n");
}

describe("operational status rail source contract", () => {
  it("composes the rail from installed shadcn primitives", () => {
    const rail = source("src/components/OperationalStatusRail.tsx");

    expect(rail).toContain('from "@/components/ui/badge"');
    expect(rail).toContain('from "@/components/ui/button"');
    expect(rail).toContain('from "@/components/ui/collapsible"');
    expect(rail).toContain('from "@/components/ui/separator"');
    expect(rail).toContain('from "@/components/ui/tooltip"');
    expect(rail).toContain("<CollapsibleTrigger asChild>");
    expect(rail).toContain("<Button");
    expect(rail).toContain("<Badge");
  });

  it("prioritizes exceptions, bounds the visible rail, and accounts for overflow", () => {
    const rail = source("src/components/OperationalStatusRail.tsx");

    expect(rail).toContain("const TONE_RANK");
    expect(rail).toContain("maxVisibleItems = 3");
    expect(rail).toContain("const visibleItems = prioritizedItems.slice(0, maxVisibleItems)");
    expect(rail).toContain("const hiddenCount = Math.max(0, prioritizedItems.length - visibleItems.length)");
    expect(rail).toContain("Show ${detailsLabel.toLowerCase()} and ${hiddenCount} more statuses");
    expect(rail).toContain("allClearLabel");
    expect(rail).toContain("tabular-nums");
  });

  it("keeps route calculations outside the shared presentation contract", () => {
    const rail = source("src/components/OperationalStatusRail.tsx");
    const schedule = source("src/app/(app)/schedule/_components/ScheduleReadiness.tsx");
    const fixToday = source("src/app/(app)/operations/OperationsClient.tsx");
    const items = source("src/app/(app)/items/page.tsx");

    expect(rail).not.toContain("ScheduleQueue");
    expect(rail).not.toContain("AdminFixTodayQueue");
    expect(schedule).toContain("<OperationalStatusRail");
    expect(schedule).toContain("const railItems: OperationalStatusRailItem[]");
    expect(fixToday).toContain("<OperationalStatusRail");
    expect(fixToday).toContain("const railItems: OperationalStatusRailItem[]");
    expect(items).toContain("<OperationalStatusRail");
    expect(items).toContain("const railItems: OperationalStatusRailItem[]");
    expect(items).toContain("statusSummary.map");
    expect(items).toContain("toggleStatusFilter(item.status)");
    expect(items).toContain('label: "Active inventory"');
    expect(items).toContain("ariaPressed={filters.statusFilter.has(item.status)}");
  });

  it("keeps metric cards equal height when helper copy wraps", () => {
    const feedback = source("src/components/OperationalFeedback.tsx");

    expect(feedback).toContain('"h-full min-h-[104px] border-border/40 shadow-none"');
    expect(feedback).toContain('className="block h-full min-h-10 rounded-md');
    expect(feedback).toContain('className="block h-full min-h-10 w-full rounded-md');
  });

  it("migrates page-level operational summaries without converting analytical reports", () => {
    const migratedPages = [
      "src/app/(app)/page.tsx",
      "src/app/(app)/operations/OperationsClient.tsx",
      "src/app/(app)/bulk-inventory/batteries/page.tsx",
      "src/app/(app)/notifications/page.tsx",
      "src/app/(app)/kits/page.tsx",
      "src/app/(app)/licenses/page.tsx",
      "src/app/(app)/users/onboarding-status/page.tsx",
      "src/app/(app)/settings/allowed-emails/page.tsx",
    ];

    for (const page of migratedPages) {
      expect(sourceForMigratedPage(page), page).toContain("<OperationalStatusRail");
    }

    expect(existsSync("src/app/(app)/dashboard/stat-card.tsx")).toBe(false);
    expect(source("src/app/(app)/reports/checkouts/page.tsx")).not.toContain("<OperationalStatusRail");
    expect(source("src/app/(app)/import/_components/ImportPreviewStep.tsx")).not.toContain("<OperationalStatusRail");
  });

  it("preserves filter selection in rail details where the summary is a facet", () => {
    const notifications = source("src/app/(app)/notifications/page.tsx");
    const onboarding = source("src/app/(app)/users/onboarding-status/page.tsx");
    const allowedEmails = source("src/app/(app)/settings/allowed-emails/page.tsx");

    expect(notifications).toContain('value={unreadOnly ? "unread" : "all"}');
    expect(onboarding).toContain('ariaPressed={statusFilter === "stale"}');
    expect(allowedEmails).toContain('ariaPressed={statusFilter === "unclaimed"}');
  });
});
