import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/**
 * Swift line comments, removed. These files explain *why* a forbidden field is
 * forbidden, so a bare `not.toContain` would fail on the prose that documents
 * the rule. Assert against code only.
 */
function code(swift: string) {
  return swift
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * The Home Screen widgets run in the Live Activities extension process, which
 * has no session cookie, no keychain item, and no `APIClient`. Everything they
 * show crosses a process boundary through an App Group. These pin the two
 * things that boundary can get wrong: publishing data that is not the phone
 * owner's, and leaving it there after they sign out.
 */
describe("iOS Home Screen widgets", () => {
  const snapshot = source("ios/Wisconsin/Widgets/GearWidgetSnapshot.swift");
  const publisher = source("ios/Wisconsin/Widgets/GearWidgetPublisher.swift");
  const widgets = source("ios/WisconsinLiveActivities/GearHomeScreenWidgets.swift");
  const bundle = source("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift");
  const projectYml = source("ios/project.yml");
  const home = source("ios/Wisconsin/Views/HomeView.swift");
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const dashboardRoute = source("src/app/api/dashboard/route.ts");

  it("vends the widgets from the existing extension bundle", () => {
    expect(bundle).toContain("NextShiftWidget()");
    expect(bundle).toContain("GearDueWidget()");
    // One extension, one bundle. A second widget target would need its own
    // provisioning profile for no gain.
    expect(widgets).not.toContain("@main");
    expect(widgets).toContain('StaticConfiguration(kind: "NextShiftWidget"');
    expect(widgets).toContain('StaticConfiguration(kind: "GearDueWidget"');
  });

  it("shares one snapshot contract between both processes", () => {
    expect(projectYml).toContain("- path: Wisconsin/Widgets/GearWidgetSnapshot.swift");
    // The app-side publisher must NOT be in the extension — it imports the
    // dashboard models the widget process has no business decoding.
    expect(projectYml).not.toContain("GearWidgetPublisher.swift");
    expect(snapshot).toContain('static let appGroupIdentifier = "group.com.erikrole.Wisconsin"');
  });

  it("entitles both targets to the same App Group", () => {
    const appEntitlements = source("ios/Wisconsin/Wisconsin.entitlements");
    const extEntitlements = source(
      "ios/WisconsinLiveActivities/WisconsinLiveActivities.entitlements",
    );
    for (const file of [appEntitlements, extEntitlements]) {
      expect(file).toContain("com.apple.security.application-groups");
      expect(file).toContain("group.com.erikrole.Wisconsin");
    }
  });

  /**
   * `/api/dashboard` is two-scoped: `myCheckouts` is the caller's, while
   * `overdueCount` and `stats.overdue` are `totalOverdue` — team-wide for
   * staff and admins. A widget renders on a locked phone, so publishing the
   * team total under a "My Gear" heading would leak the team's state to
   * anyone holding the device.
   */
  it("publishes only the signed-in user's own work", () => {
    expect(dashboardRoute).toContain("overdueCount: totalOverdue");
    expect(dashboardRoute).toContain("overdue: myOverdueCount");

    const publisherCode = code(publisher);
    expect(publisherCode).toContain("overdueCount: dashboard.myCheckouts.overdue");
    expect(publisherCode).not.toContain("dashboard.overdueCount");
    expect(publisherCode).not.toContain("dashboard.stats");
    expect(publisherCode).not.toContain("teamCheckouts");
    expect(publisherCode).toContain("let myCheckouts = dashboard.myCheckouts.items");
  });

  it("never turns the home/away flag into a venue", () => {
    // `docs/AREA_SHIFTS.md`: isHome is not a venue. The widget carries the
    // event's own site name or nothing at all.
    expect(publisher).toContain("locationName: shift.event.locationName");
    expect(code(publisher)).not.toContain("isHome");
    expect(code(widgets)).not.toContain("isHome");
  });

  it("keeps a widget from outliving the session that filled it", () => {
    expect(app).toContain("GearWidgetPublisher.clear()");
    // Clearing without a reload leaves the last rendered timeline on screen.
    expect(publisher).toContain("GearWidgetStore.clear()");
    const clearFn = publisher.slice(publisher.indexOf("static func clear()"));
    expect(clearFn).toContain("WidgetCenter.shared.reloadAllTimelines()");
    expect(widgets).toContain(".privacySensitive()");
  });

  it("refreshes from the one surface that loads the whole dashboard", () => {
    expect(home).toContain("GearWidgetPublisher.publish(from: loadedDashboard)");
    const publish = publisher.slice(
      publisher.indexOf("static func publish("),
      publisher.indexOf("static func clear()"),
    );
    expect(publish).toContain("WidgetCenter.shared.reloadAllTimelines()");
  });

  it("routes widget taps through the capability-gated router", () => {
    expect(widgets).toContain('URL(string: "wisconsin://schedule")');
    expect(widgets).toContain('URL(string: "wisconsin://bookings")');
    expect(app).toContain('case "schedule":');
    expect(app).toContain("appState.pendingAppIntentDestination = .todaySchedule");
    expect(app).toContain('case "bookings":');
    expect(app).toContain("appState.pendingAppIntentDestination = .myGear");

    // Both destinations are capability-checked before the tab switches.
    const tabView = source("ios/Wisconsin/Views/AppTabView.swift");
    expect(tabView).toContain('hasCapability("PUBLISHED_SCHEDULE_VIEW")');
    expect(tabView).toContain('hasCapability("MY_GEAR_VIEW")');
  });

  it("degrades instead of trapping when the App Group is missing", () => {
    expect(snapshot).toContain("private static var sharedDefaults: UserDefaults? {");
    expect(snapshot).not.toContain("UserDefaults(suiteName: appGroupIdentifier)!");
    expect(widgets).toContain("WidgetPlaceholder(");
    expect(widgets).toContain("Open Creative to see your next shift.");
  });

  it("does not ship a preview that shows anyone's real shift", () => {
    const preview = widgets.slice(widgets.indexOf("static let preview"));
    expect(preview).toContain('id: "preview"');
    expect(widgets).toContain("context.isPreview ? .preview : GearWidgetStore.read()");
  });
});
