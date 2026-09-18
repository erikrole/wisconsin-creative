import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS entry-point routing", () => {
  const router = source("ios/Wisconsin/Core/GearTrackerRoute.swift");
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const appDelegate = source("ios/Wisconsin/App/AppDelegate.swift");
  const appState = source("ios/Wisconsin/Core/AppState.swift");
  const inbox = source("ios/Wisconsin/Views/NotificationsSheet.swift");
  const home = source("ios/Wisconsin/Views/HomeView.swift");
  const controls = source("ios/WisconsinLiveActivities/GearControls.swift");
  const association = source("src/app/.well-known/apple-app-site-association/route.ts");
  const entitlements = source("ios/Wisconsin/Wisconsin.entitlements");
  const project = source("ios/project.yml");

  it("parses custom URLs, universal links, and notification payloads in one place", () => {
    expect(router).toContain("enum GearTrackerRoute");
    expect(router).toContain("static func parse(_ url: URL)");
    expect(router).toContain("static func parseNotification(");
    expect(router).toContain("case \"reservations\":");
    expect(router).toContain("case \"checkouts\":");
    expect(router).toContain("case \"scan\":");
    expect(router).toContain("case licenses");
    expect(app).toContain("GearTrackerRouteParser.parse(url)");
    expect(app).toContain("appState.apply(route)");
    expect(appDelegate).toContain("GearTrackerRouteParser.parseNotification(userInfo:");
    expect(appState).toContain("func apply(_ route: GearTrackerRoute)");
  });

  it("routes inbox taps through the same destination map as APNs", () => {
    expect(inbox).toContain("GearTrackerRouteParser.parseNotification(payload:");
    expect(inbox).toContain("onRoute?(route)");
    expect(home).toContain("appState.apply(route)");
    expect(home).toContain("pendingInboxRoute");
  });

  it("covers license, firmware, item, badge, and inbox families instead of swallowing them", () => {
    expect(router).toContain("isLicenseType");
    expect(router).toContain("case item(String)");
    expect(router).toContain("case user(String)");
    expect(router).toContain("case inbox");
    expect(router).toContain("?? .inbox");
    expect(appState).toContain("pendingPushAssetId");
    expect(appState).toContain("pendingNotificationsInbox");
    expect(home).toContain("pendingPushAssetId");
    expect(home).toContain("showNotifications = true");
  });

  it("publishes Control Center actions that open the same URLs", () => {
    expect(controls).toContain("struct ScanGearControl: ControlWidget");
    expect(controls).toContain('OpenURLIntent(URL(string: "wisconsin://scan")!)');
    expect(controls).toContain('OpenURLIntent(URL(string: "wisconsin://bookings")!)');
    expect(controls).toContain('OpenURLIntent(URL(string: "wisconsin://reserve")!)');
  });

  it("advertises applinks for operational web paths without claiming settings or APIs", () => {
    expect(association).toContain("applinks");
    expect(association).toContain('"/events/*"');
    expect(association).toContain('"/reservations/*"');
    expect(association).toContain('"/checkouts/*"');
    expect(association).toContain('"/notifications"');
    expect(association).not.toContain('"/settings"');
    expect(association).not.toContain('"/api"');
    expect(entitlements).toContain("applinks:wisconsincreative.com");
    expect(project).toContain("applinks:wisconsincreative.com");
    expect(entitlements).toContain("webcredentials:wisconsincreative.com");
  });
});
