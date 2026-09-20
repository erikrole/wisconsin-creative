import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS launch lifecycle performance", () => {
  it("keeps initial session validation under one request owner", () => {
    const session = source("ios/Wisconsin/Core/SessionStore.swift");

    expect(session).toContain("private(set) var isInitialSessionValidationInFlight = true");
    expect(session).toContain("guard currentUser != nil, !isInitialSessionValidationInFlight else { return }");
    expect(session).toContain('var result = "superseded"');
    expect(session).toContain('result = "authenticated"');
    expect(session).toContain('result = "unauthorized"');
    expect(session).toContain('result = optimistic ? "offline-optimistic" : "offline"');
    expect(session).not.toContain('var result = "unknown"');
  });

  it("publishes decoded user state only when its value changed", () => {
    const session = source("ios/Wisconsin/Core/SessionStore.swift");

    expect(session).toContain("private func publishCurrentUserIfChanged(_ user: CurrentUser)");
    expect(session).toContain("if currentUser != user");
    expect(session).toContain("currentUser = user");
    expect(session).toContain("SessionSnapshot.save(user)");
    expect(session).toMatch(/restoreSession[\s\S]*?publishCurrentUserIfChanged\(user\)/);
    expect(session).toMatch(/refreshCurrentUser[\s\S]*?publishCurrentUserIfChanged\(user\)/);
  });

  it("owns foreground lifecycle work at the app root instead of the tab shell", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(app).toContain("handleScenePhaseChange(phase)");
    expect(app).toContain("!session.isInitialSessionValidationInFlight");
    expect(app).toContain("Task { await refreshForegroundState() }");
    expect(app).toContain("await session.refreshCurrentUser()");
    expect(tabs).not.toContain("@Environment(\\.scenePhase)");
    expect(tabs).not.toContain("session.refreshCurrentUser()");
  });

  it("starts badge and Live Activity refreshes only after Home receives its payload", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const initialUserChangeHandler = app.slice(
      app.indexOf("private func handleCurrentUserChange"),
      app.indexOf("private func handleScenePhaseChange"),
    );
    const load = home.slice(
      home.indexOf("func load(appState: AppState?"),
      home.indexOf("private static func refreshSecondaryLaunchState"),
    );

    expect(load.indexOf("let loadedDashboard = try await APIClient.shared.dashboard()"))
      .toBeLessThan(load.indexOf("refreshSecondaryLaunchState("));
    expect(load.indexOf("dashboard = loadedDashboard"))
      .toBeLessThan(load.indexOf("refreshSecondaryLaunchState("));
    expect(home).toContain("await appState.refresh(forceRefresh: forceRefresh)");
    expect(home).toContain("async let liveActivityRefresh");
    expect(home).toContain("await CheckoutReturnLiveActivityManager.shared.prepareRemoteStartRegistration()");
    expect(initialUserChangeHandler).not.toContain("prepareRemoteStartRegistration");
  });

  it("preserves stable native tab identities and capability gates", () => {
    const tabs = source("ios/Wisconsin/Views/AppTabView.swift");

    expect(tabs).toContain('if hasCapability("PUBLISHED_SCHEDULE_VIEW")');
    expect(tabs).toContain('if hasCapability("MY_GEAR_VIEW")');
    expect(tabs).toContain('if hasCapability("GEAR_CATALOG_VIEW")');
    expect(tabs).not.toContain("AnyView");
    expect(tabs).not.toContain(".equatable()");
  });
});
