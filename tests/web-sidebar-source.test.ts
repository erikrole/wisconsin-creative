import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("web sidebar source contract", () => {
  it("keeps lookup out of the web sidebar because desktop search is text-first", () => {
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).not.toContain('label: "Lookup"');
    expect(sidebar).not.toContain('href: "/scan"');
    expect(sidebar).not.toContain("ScanIcon");
    expect(sidebar).not.toContain("/scan?checkout");
  });

  it("keeps personal Settings reachable for every role from the account menu", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const staffItems = sidebar.match(/staffOnly: true,\s*items: \[([\s\S]*?)\],\s*\},/);

    expect(sidebar).toContain('const SETTINGS_HREF = "/settings"');
    expect(sidebar).toContain("href={SETTINGS_HREF}");
    expect(staffItems?.[1]).toContain("Kits");
    expect(staffItems?.[1]).not.toContain("Settings");
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

    expect(appShell).toContain("useDashboardStats()");
    expect(appShell).toContain("dashboardStats?.myDueTodayCount ?? 0");
    expect(sidebar).toContain("dueTodayBadgeCount?: number");
    expect(sidebar.indexOf("overdueBadgeCount > 0")).toBeLessThan(
      sidebar.indexOf("dueTodayBadgeCount > 0"),
    );
    expect(sidebar).toContain('suffix: "due today"');
    expect(sidebar).toContain("bg-[var(--orange-bg)] text-[color:var(--orange-text)]");
  });

  it("does not replace ambient counts with partial dashboard fallbacks", () => {
    const appShell = source("src/components/AppShell.tsx");

    expect(appShell).toContain("useDashboardStats()");
    expect(source("src/hooks/use-dashboard-data.ts")).toContain("hasDashboardCountFailure(partialFailures)");
    expect(appShell).not.toContain('fetch("/api/dashboard/stats"');
    expect(appShell).toMatch(/fetchQuery\(\{\s*\.\.\.dashboardStatsQueryOptions\(badgeUserId\),[\s\S]*?staleTime: 0,/);
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

    expect(appShell).toContain('{ label: "Bookings", href: "/bookings", icon: ClipboardListIcon');
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

  it("keeps profile navigation in the sidebar account menu", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).toContain('href={`/staff/${user.id}`}');
    expect(sidebar).toContain('aria-label="Account menu"');
    expect(appShell).not.toContain('aria-label="My profile"');
    expect(appShell).not.toContain("<TooltipContent>Profile</TooltipContent>");
  });

  it("avoids authenticated shell RSC prefetch failures in Safari", () => {
    const appShell = source("src/components/AppShell.tsx");
    const sidebar = source("src/components/Sidebar.tsx");
    const sectionNav = source("src/components/SectionNav.tsx");

    expect(sidebar).toMatch(/<Link\s+prefetch=\{false\}\s+href=\{`\/staff\/\$\{user\.id\}`\}/);
    expect(sidebar).toMatch(/<Link prefetch=\{false\} href=\{href\}/);
    expect(source("src/components/NotificationsPopover.tsx")).toMatch(/<Link\s+prefetch=\{false\}\s+href="\/notifications"/);
    expect(sectionNav).toMatch(/<Link\s+prefetch=\{false\}\s+href=\{href\}/);
  });

  it("surfaces admin role preview as persistent read-only shell chrome", () => {
    const appShell = source("src/components/AppShell.tsx");
    const preview = source("src/components/RolePreviewControl.tsx");
    const appLayout = source("src/app/(app)/layout.tsx");

    expect(appShell).toContain("RolePreviewBanner");
    expect(appShell).toContain("RolePreviewControl");
    expect(preview).toContain('data-role-preview="active"');
    expect(preview).toContain("Read-only");
    expect(preview).toContain("Exit preview");
    expect(preview).toContain("STAFF");
    expect(preview).toContain("STUDENT");
    expect(preview).toContain("COLLABORATOR");
    expect(preview).toContain("Big Ten Network");
    expect(preview).toContain("Learfield");
    expect(appLayout).toContain("!user.preview && <ProductUsageTracker />");
  });

  it("groups destinations and keeps notifications in the top bar only", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const appShell = source("src/components/AppShell.tsx");

    expect(sidebar).toContain('label: "People"');
    expect(sidebar).toContain('label: "Purchasing"');
    expect(sidebar).toContain('label: "Library"');
    expect(sidebar).not.toContain('{ label: "Notifications"');
    expect(sidebar).not.toContain("unreadNotifications");
    const topBar = source("src/components/AppTopBar.tsx");
    expect(appShell).toContain("<AppTopBar");
    expect(topBar).toContain("<NotificationsPopover");
    expect(source("src/components/NotificationsPopover.tsx")).toContain('href="/notifications"');
    expect(topBar).toContain("Search items, bookings, people, pages, and guides");
  });

  it("uses collaborator affiliation identity instead of a generic external label", () => {
    const sidebar = source("src/components/Sidebar.tsx");

    expect(sidebar).toContain("user.collaboratorPolicy?.displayName");
    expect(sidebar).toContain('"External collaborator"');
  });

  it("owns its typeface and tokens so page-scoped themes cannot restyle it", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const css = source("src/app/globals.css");

    expect(source("src/lib/chrome-font.ts")).toContain('import { Lato } from "next/font/google"');
    expect(sidebar).toContain("chromeFont.className");
    expect(sidebar).not.toContain("brand-identity");
    expect(sidebar).not.toContain('fontFamily: "var(--font-heading)"');
    expect(css).toContain("--color-sidebar-border: var(--sidebar-border)");
    expect(css).toContain("--color-sidebar-ring: var(--sidebar-ring)");
  });

  it("gives truncated sidebar labels room for descenders", () => {
    // `truncate` clips overflow, so a 1.0 line box cuts the tails off g, y, p, q and j in Lato.
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toContain("text-[13.5px] leading-5");
    expect(sidebar).not.toContain("text-[13.5px] leading-none");
    expect(sidebar).not.toContain("leading-[1.15]");
  });
});
