import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS AppState refresh energy budget", () => {
  it("throttles non-critical foreground badge refreshes", () => {
    const appState = source("ios/Wisconsin/Core/AppState.swift");

    expect(appState).toContain("private var lastRefreshAttemptAt: Date?");
    expect(appState).toContain("private let minimumRefreshInterval: TimeInterval = 60");
    expect(appState).toContain("func refresh(forceRefresh: Bool = false) async");
    expect(appState).toContain("Date().timeIntervalSince(lastRefreshAttemptAt) < minimumRefreshInterval");
    expect(appState).toContain("lastRefreshAttemptAt = Date()");
  });

  it("keeps lifecycle refresh opportunistic but forces user-driven badge updates", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");

    expect(app).toContain("async let badgeRefresh: Void = appState.refresh()");
    expect(home).toContain("await appState.refresh(forceRefresh: forceRefresh)");
    expect(schedule).toContain("Task { await appState.refresh(forceRefresh: true) }");
  });

  it("keeps the Schedule tab badge scoped to today's shifts", () => {
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const appTab = source("ios/Wisconsin/Views/AppTabView.swift");
    const models = source("ios/Wisconsin/Models/DashboardModels.swift");

    expect(models).toContain("let myShiftsTodayCount: Int?");
    expect(appState).toContain("var myShiftTodayCount = 0");
    expect(appState).toContain("myShiftCount = stats.myShiftsCount");
    expect(appState).toContain("myShiftTodayCount = stats.myShiftsTodayCount ?? 0");
    expect(appTab).toContain(".badge(appState.myShiftTodayCount)");
    expect(appTab).toContain("\"Schedule, \\(appState.myShiftTodayCount) shifts today\"");
    expect(appTab).not.toContain(".badge(appState.myShiftCount)");
    expect(appTab).not.toContain("upcoming shifts");
  });
});
