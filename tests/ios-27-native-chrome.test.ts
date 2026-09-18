import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS 27 native chrome with an iOS 26 floor", () => {
  it("builds with the iOS 27 SDK without raising the deployment target", () => {
    const project = source("ios/project.yml");
    const instrumentation = source(
      "ios/Wisconsin/Core/PerformanceInstrumentation.swift",
    );

    expect(project).toContain('xcodeVersion: "27.0"');
    expect(project).toContain('iOS: "26.0"');
    expect(project).toContain('deploymentTarget: "26.0"');
    expect(instrumentation).toContain("MXMetricManager.shared.add(self)");
    expect(instrumentation).not.toMatch(/\bMetricManager\b/);
    expect(instrumentation).not.toContain("iOS 27");
    expect(instrumentation).not.toContain("#available(iOS 27");
  });

  it("recedes the tab bar with content except while a reservation draft is parked", () => {
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(tabs).toContain(
      ".tabBarMinimizeBehavior(drafts.showsCard ? .never : .onScrollDown)",
    );
    expect(tabs).toContain('Tab("Search", systemImage: "magnifyingglass", value: 3, role: .search)');
    expect(tabs).not.toContain("role: .prominent");
  });

  it("opts scrolling operational lists into iOS 27 navigation-bar minimization", () => {
    const chrome = source("ios/Wisconsin/Core/NativeChrome.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const scoreboard = source("ios/Wisconsin/Views/TeamScoreboardView.swift");
    const items = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(chrome).toContain("if #available(iOS 27.0, *)");
    expect(chrome).toContain(
      "self.toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)",
    );
    expect(home).toContain(".nativeScrollBarMinimization()");
    expect(bookings).toContain(".nativeScrollBarMinimization()");
    expect(schedule).toContain(".nativeScrollBarMinimization()");
    expect(scoreboard).toContain(".nativeScrollBarMinimization()");
    // Search-leading lists keep the bar so the always-on drawer stays put.
    expect(items).not.toContain(".nativeScrollBarMinimization()");
  });

  it("keeps create, trade, and list controls visible when iOS 27 resizes the toolbar", () => {
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");
    const items = source("ios/Wisconsin/Views/ItemsView.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
    const guides = source("ios/Wisconsin/Views/GuidesView.swift");

    expect(bookings).toContain("ToolbarItem(placement: .topBarPinnedTrailing)");
    expect(bookings).toContain("bookingsNewReservationButton");
    expect(bookings).toContain(".visibilityPriority(.high)");
    expect(items).toContain(".visibilityPriority(.high)");
    expect(guides).toContain(".visibilityPriority(.high)");
    expect(schedule).toContain("struct ScheduleRootToolbar: ToolbarContent");
    expect(schedule).toContain("ToolbarOverflowMenu");
    expect(schedule).toContain(".visibilityPriority(.high)");
    expect(eventDetail).toContain("ToolbarItem(placement: .topBarPinnedTrailing)");
  });

  it("shares the thumbnail URL cache with AsyncImage on iOS 27", () => {
    const chrome = source("ios/Wisconsin/Core/NativeChrome.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const loader = source("ios/Wisconsin/Core/ThumbnailLoader.swift");

    expect(loader).toContain("enum RemoteImageLoading");
    expect(chrome).toContain("self.asyncImageURLSession(RemoteImageLoading.session)");
    expect(app).toContain(".nativeRemoteImageSession()");
  });

  it("dims the custom profile avatar when the window is inactive", () => {
    const avatar = source("ios/Wisconsin/Views/AccountAvatar.swift");

    expect(avatar).toContain("@Environment(\\.appearsActive) private var appearsActive");
    expect(avatar).toContain(".opacity(appearsActive ? 1 : 0.5)");
  });
});
