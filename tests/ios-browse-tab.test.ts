import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function appTabViewShell() {
  return source("ios/Wisconsin/Views/AppTabView.swift").split("// MARK: - Profile")[0] ?? "";
}

describe("iOS Browse tab", () => {
  it("uses a native Browse tab instead of burying Items as its own compact tab", () => {
    const appTab = appTabViewShell();

    const homeIndex = appTab.indexOf('Tab("Home", systemImage: "house", value: 0)');
    const scheduleIndex = appTab.indexOf('Tab("Schedule", systemImage: "calendar", value: 4)');
    const bookingsIndex = appTab.indexOf("Tab(gearTabLabel, systemImage: \"calendar.badge.checkmark\", value: 1)");
    const browseIndex = appTab.indexOf('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    const searchIndex = appTab.indexOf('Tab("Search", systemImage: "magnifyingglass", value: 3, role: .search)');

    expect([homeIndex, scheduleIndex, bookingsIndex, browseIndex, searchIndex].every((index) => index >= 0)).toBe(true);
    expect(homeIndex).toBeLessThan(scheduleIndex);
    expect(scheduleIndex).toBeLessThan(bookingsIndex);
    expect(bookingsIndex).toBeLessThan(browseIndex);
    expect(browseIndex).toBeLessThan(searchIndex);
    expect(appTab).toContain("BrowseView()");
    expect(appTab).not.toContain('Tab("Items", systemImage: "archivebox", value: 2)');
    expect(appTab).toContain('Tab("Search", systemImage: "magnifyingglass", value: 3, role: .search)');
    expect(appTab).toContain(".tabPlacement(.pinned)");
  });

  it("renders Browse as a native SwiftUI list of directory links", () => {
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(browse).toContain("NavigationStack(path: $navigationPath) {");
    expect(browse).toContain("List {");
    expect(browse).toContain(".listStyle(.insetGrouped)");
    expect(browse).toContain('.navigationTitle("Browse")');
    expect(browse).not.toContain('Text("More")');
    expect(browse).not.toContain('Text("Browse")');
    expect(browse).toContain("NavigationLink(value: destination)");
    expect(browse).toContain("SettingsMenuRow(");
    expect(browse).toContain("TeamScoreboardView(wrapsInNavigationStack: false)");
    expect(browse).toContain("ItemsView(wrapsInNavigationStack: false)");
    expect(browse).toContain("GuidesView(wrapsInNavigationStack: false)");
    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
    expect(browse).toContain("UsersView(wrapsInNavigationStack: false)");
    expect(browse).not.toContain("SidebarWebDestinationView");
  });

  it("keeps Browse destination pushes in one parent navigation stack", () => {
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");
    const items = source("ios/Wisconsin/Views/ItemsView.swift");
    const users = source("ios/Wisconsin/Views/UsersView.swift");

    expect(browse).toContain("@State private var navigationPath = NavigationPath()");
    expect(browse).toContain(".navigationDestination(for: BrowseDestination.self)");
    expect(browse).toContain("guard appState.resetTab == 2 else { return }");
    expect(browse).toContain("navigationPath = NavigationPath()");

    expect(items).toContain("var wrapsInNavigationStack = true");
    expect(items).toContain("if wrapsInNavigationStack {");
    expect(items).toContain("placement: .navigationBarDrawer(displayMode: .always)");
    expect(items).toContain("drafts.start({");
    expect(items).toContain(".navigationDestination(for: BookingRouteId.self)");

    expect(users).toContain("var wrapsInNavigationStack = true");
    expect(users).toContain("if wrapsInNavigationStack {");
    expect(users).toContain("placement: .navigationBarDrawer(displayMode: .always)");
  });

  it("exposes Users to every authenticated role while preserving admin-only tools elsewhere", () => {
    const appTab = appTabViewShell();
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(appTab).toContain('TabSection("Resources")');
    expect(appTab).toContain('Tab("Users", systemImage: "person.2", value: 5)');
    expect(appTab).not.toContain('TabSection("Admin")');
    expect(appTab).not.toMatch(/if isStaffOrAdmin \{[\s\S]*?Tab\("Users"/);

    expect(browse).toContain("case .users:");
    expect(browse).toContain("UsersView(wrapsInNavigationStack: false)");
  });

  it("keeps Scoreboard in Browse even when a collaborator has no optional capabilities", () => {
    const appTab = appTabViewShell();
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(appTab).toContain("Browse always exists because the shared Scoreboard is available");
    expect(browse).toContain("return [.scoreboard] + [");
    expect(browse).toContain("case scoreboard");
    expect(browse).toContain('case .scoreboard: "Scoreboard"');
    expect(browse).toContain("Team totals, sport breakdowns, and per-person leaderboards.");
  });
});
