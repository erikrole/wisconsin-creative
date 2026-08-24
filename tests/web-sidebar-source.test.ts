import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("web sidebar source contract", () => {
  it("keeps lookup out of the web sidebar because desktop search is text-first", () => {
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).not.toContain('label: "Lookup"');
    expect(sidebar).not.toContain('href: "/scan"');
    expect(sidebar).not.toContain("ScanIcon");
    expect(sidebar).not.toContain("/scan?checkout");
  });

  it("keeps personal Settings reachable outside admin-only navigation", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const settingsIndex = sidebar.indexOf('{ label: "Settings", href: "/settings", icon: SettingsIcon }');
    const operationsGroupIndex = sidebar.indexOf('label: "Operations"');

    expect(settingsIndex).toBeGreaterThan(-1);
    expect(operationsGroupIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeLessThan(operationsGroupIndex);
  });

  it("promotes Accountability into primary internal navigation", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const accountabilityEntry =
      '{ label: "Accountability", href: "/accountability", icon: ShieldAlertIcon }';
    const accountabilityIndex = sidebar.indexOf(accountabilityEntry);
    const operationsGroupIndex = sidebar.indexOf('label: "Operations"');

    expect(accountabilityIndex).toBeGreaterThan(-1);
    expect(accountabilityIndex).toBeLessThan(operationsGroupIndex);
    expect(sidebar).not.toContain(
      '{ label: "Accountability", href: "/accountability", icon: ShieldAlertIcon, requiredRole:',
    );
  });

  it("puts Scoreboard in primary navigation for every authenticated role", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const appShell = source("src/components/AppShell.tsx");
    const scoreboardEntry = '{ label: "Scoreboard", href: "/scoreboard", icon: TrophyIcon }';
    const scoreboardIndex = sidebar.indexOf(scoreboardEntry);
    const operationsGroupIndex = sidebar.indexOf('label: "Operations"');

    expect(scoreboardIndex).toBeGreaterThan(-1);
    expect(scoreboardIndex).toBeLessThan(operationsGroupIndex);
    expect(sidebar).toContain('"/scoreboard"');
    expect(sidebar).not.toContain(
      '{ label: "Scoreboard", href: "/scoreboard", icon: TrophyIcon, requiredRole:',
    );
    expect(appShell).toContain('pathname === "/scoreboard"');
    expect(appShell).toContain('pathname.startsWith("/scoreboard/")');
  });

  it("uses user-scoped due-today counts and overdue-first badge priority", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");

    expect(appShell).toContain("myDueTodayCount?: unknown");
    expect(appShell).toContain("setDueTodayBadgeCount(dueToday)");
    expect(sidebar).toContain("dueTodayBadgeCount?: number");
    expect(sidebar.indexOf("overdueBadgeCount > 0")).toBeLessThan(
      sidebar.indexOf("dueTodayBadgeCount > 0"),
    );
    expect(sidebar).toContain('suffix: "due today"');
    expect(sidebar).toContain("bg-[var(--orange-bg)] text-[var(--orange-text)]");
  });

  it("does not replace ambient counts with partial dashboard fallbacks", () => {
    const appShell = source("src/components/AppShell.tsx");

    expect(appShell).toContain("hasDashboardCountFailure");
    expect(appShell).toContain("dashboardBadgeCountsAreTrusted");
    expect(appShell).toContain("partialFailures?: unknown[]");
  });

  it("does not wire sidebar keyboard shortcuts that conflict with browser shortcuts", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).not.toContain("shortcut:");
    expect(sidebar).not.toContain("SIDEBAR_SHORTCUT_TARGETS");
    expect(sidebar).not.toContain("⌘");
    expect(appShell).not.toContain("SIDEBAR_SHORTCUT_TARGETS");
    expect(appShell).not.toContain("targetRoute.href");
    expect(appShell).toContain('e.key === "k"');
    expect(source("src/components/ui/sidebar.tsx")).not.toContain("SIDEBAR_KEYBOARD_SHORTCUT");
  });

  it("keeps staff navigation labeled as operations and restores collapse state", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const appLayout = source("src/app/(app)/layout.tsx");
    const appShell = source("src/components/AppShell.tsx");

    expect(sidebar).toContain('label: "Operations"');
    expect(sidebar).not.toContain('label: "Admin"');
    expect(appLayout).toContain('cookieStore.get("sidebar_state")');
    expect(appShell).toContain("defaultOpen={defaultSidebarOpen}");
  });

  it("uses unified mobile Bookings and closes the mobile drawer on navigation", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");
    const primitive = source("src/components/ui/sidebar.tsx");

    expect(appShell).toContain('{ label: "Bookings", href: "/bookings", icon: BookOpenIcon');
    expect(appShell).not.toContain('{ label: "Reservations", href: "/reservations"');
    expect(appShell).not.toContain('{ label: "Checkouts", href: "/checkouts"');
    expect(sidebar).toContain("setOpenMobile(false)");
    expect(primitive).not.toContain("[&>button]:hidden");
    expect(primitive).toContain("Workspace navigation");
  });

  it("keeps sidebar controls at the operational target floor", () => {
    const primitive = source("src/components/ui/sidebar.tsx");

    expect(primitive).toContain('className={cn("size-10", className)}');
    expect(primitive).toContain('default: "h-10 text-sm"');
    expect(primitive).toContain("group-data-[collapsible=icon]:size-10!");
  });

  it("keeps profile navigation in the sidebar identity card", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).toContain('href={`/users/${user.id}`}');
    expect(appShell).not.toContain('aria-label="My profile"');
    expect(appShell).not.toContain("<TooltipContent>Profile</TooltipContent>");
  });

  it("avoids authenticated shell RSC prefetch failures in Safari", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");
    const sectionNav = source("src/components/SectionNav.tsx");

    expect(sidebar).toMatch(/<Link\s+prefetch=\{false\}\s+href=\{`\/users\/\$\{user\.id\}`\}/);
    expect(sidebar).toMatch(/<Link prefetch=\{false\} href=\{href\}/);
    expect(appShell).toContain('<Link prefetch={false} href="/notifications"');
    expect(sectionNav).toMatch(/<Link\s+prefetch=\{false\}\s+href=\{href\}/);
  });
});
