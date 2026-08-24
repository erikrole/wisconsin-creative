import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function appTabViewShell() {
  return source("ios/Wisconsin/Views/AppTabView.swift").split("// MARK: - Profile")[0] ?? "";
}

describe("iOS tab bar stability", () => {
  it("uses the native SwiftUI Tab API for the primary app shell", () => {
    const appTab = appTabViewShell();

    expect(appTab).toContain("TabView(selection:");
    expect(appTab).toContain('Tab("Home", systemImage: "house", value: 0)');
    expect(appTab).toContain('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    expect(appTab).toContain("BrowseView()");
    expect(appTab).toContain('Tab("Schedule", systemImage: "calendar", value: 4)');
    expect(appTab).toContain('Tab("Search", systemImage: "magnifyingglass", value: 3, role: .search)');
    expect(appTab).toContain("GlobalSearchSheet(showsCancelButton: false)");
    expect(appTab).toContain(".tabPlacement(.pinned)");
    expect(appTab).toContain("AppTabShellStyle(usesSidebarAdaptableStyle: showsSidebarDestinations)");
    expect(appTab).toContain("content.tabViewStyle(.tabBarOnly)");
    expect(appTab).toContain("content.tabViewStyle(.sidebarAdaptable)");
    expect(appTab).toContain("private var showsSidebarDestinations: Bool");
    expect(appTab).toContain("horizontalSizeClass == .regular");
    expect(appTab).toContain('TabSection("Team")');
    expect(appTab).toContain('Tab("Scoreboard", systemImage: "trophy", value: 8)');
    expect(appTab).toContain("TeamScoreboardView()");
    expect(appTab).toContain('TabSection("Resources")');
    expect(appTab).toContain('Tab("Guides", systemImage: "book.closed", value: 6)');
    expect(appTab).toContain('Tab("Users", systemImage: "person.2", value: 5)');
    expect(appTab).toContain('Tab("Licenses", systemImage: "key", value: 7)');
    expect(appTab.match(/\.tabPlacement\(\.sidebarOnly\)/g)).toHaveLength(4);
    expect(appTab).not.toContain('TabSection("Admin")');
    expect(appTab).not.toContain('Tab("Items", systemImage: "archivebox", value: 2)');
    expect(appTab).not.toContain(".tabItem");
    expect(appTab).not.toContain(".tag(");
    expect(appTab).not.toContain(".toolbar(.hidden, for: .tabBar)");
    expect(appTab).not.toContain(".tabBarMinimizeBehavior(");
  });

  it("renders global Search through the native trailing search tab role, with scan inside Search", () => {
    const appTab = appTabViewShell();
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");

    expect(appTab).toContain("role: .search");
    expect(appTab).toContain("GlobalSearchSheet(showsCancelButton: false)");
    expect(appTab).not.toContain("ScanView()");
    expect(appTab).not.toContain("private struct AppTabBar");
    expect(appTab).not.toContain("private var scanTabButton");
    expect(appTab).not.toContain(".safeAreaInset(edge: .bottom");
    expect(appTab).not.toContain(".fullScreenCover(isPresented: $showScanLookup)");
    expect(appTab).not.toContain(".overlay(alignment: .bottomTrailing)");
    expect(appState).toContain("func presentSearch()");
    expect(appState).toContain("func presentScanLookup()");
    expect(appState).toContain("presentSearch()");
    expect(home).toContain("AllClearEmptyState(openSearch: { appState.presentSearch() })");
    expect(home).not.toContain("appState.selectedTab = 3");
    expect(search).toContain('Label("Scan QR code", systemImage: "qrcode.viewfinder")');
    expect(home).toContain('Label("Search or Scan", systemImage: "magnifyingglass")');
    expect(search).toContain("var showsCancelButton = true");
    expect(search).toContain("if showsCancelButton");
  });

  it("keeps secondary sidebar destinations out of the compact tab shell", () => {
    const appTab = appTabViewShell();

    expect(appTab).toContain("if showsSidebarDestinations {");
    expect(appTab).toContain("selectedTabIsSidebarOnly");
    expect(appTab).toContain("!showsSidebarDestinations && selectedTabIsSidebarOnly");
    expect(appTab).toContain("appState.selectedTab = 0");
    expect(appTab).not.toMatch(/if isStaffOrAdmin \{[\s\S]*?Tab\("Users"/);
  });

  it("uses lightweight web fallbacks only for sidebar destinations without native iOS screens", () => {
    const sidebarDestination = source("ios/Wisconsin/Views/SidebarWebDestinationView.swift");
    const appTab = appTabViewShell();

    expect(sidebarDestination).toContain("ContentUnavailableView");
    expect(sidebarDestination).toContain("var wrapsInNavigationStack = true");
    expect(sidebarDestination).toContain('Link("Open on web", destination: destination)');
    expect(appTab).toContain("GuidesView()");
    expect(appTab).not.toContain("https://wisconsincreative.com/resources");
    expect(appTab).toContain("LicensesView()");
    expect(appTab).not.toContain("https://wisconsincreative.com/licenses");
  });
});
