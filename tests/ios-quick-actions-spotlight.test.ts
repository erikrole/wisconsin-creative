import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

/** Swift line comments removed, so `not.toContain` asserts on code, not prose. */
function code(swift: string) {
  return swift
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("iOS quick actions", () => {
  const quickActions = source("ios/Wisconsin/App/QuickActions.swift");
  const appDelegate = source("ios/Wisconsin/App/AppDelegate.swift");
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const tabView = source("ios/Wisconsin/Views/AppTabView.swift");

  /**
   * A static `UIApplicationShortcutItems` list would offer every collaborator
   * a Scan and New Reservation shortcut that the router then declines,
   * producing a menu entry that does nothing. The list is built from the
   * signed-in role instead.
   */
  it("builds the shortcut menu from the signed-in role", () => {
    expect(quickActions).toContain("static func refresh(for user: CurrentUser?)");
    expect(quickActions).toContain("UIApplication.shared.shortcutItems = []");
    expect(quickActions).toContain('guard user.role == "COLLABORATOR" else { return true }');
    expect(quickActions).toContain("(user.capabilities ?? []).contains(requiredCapability)");
    expect(app).toContain("GearTrackerQuickAction.refresh(for: user)");

    const projectYml = source("ios/project.yml");
    expect(projectYml).not.toContain("UIApplicationShortcutItems");
  });

  it("keeps every shortcut's capability in step with the router", () => {
    // If these drift apart the shortcut becomes a dead end: the menu offers
    // it, the router silently declines it.
    for (const capability of [
      "GEAR_CATALOG_VIEW",
      "MY_GEAR_VIEW",
      "PUBLISHED_SCHEDULE_VIEW",
      "RESERVATION_CREATE",
    ]) {
      expect(quickActions).toContain(`"${capability}"`);
      expect(tabView).toContain(`hasCapability("${capability}")`);
    }
  });

  it("routes through the App Intents handoff instead of a second mechanism", () => {
    expect(quickActions).toContain("GearTrackerAppIntentHandoff.shared.request(action.destination)");
    expect(quickActions).toContain("var destination: GearTrackerAppIntentDestination");
    // The handoff is what makes cold launch work: it holds the destination
    // until AppTabView appears.
    expect(tabView).toContain("GearTrackerAppIntentHandoff.shared.consumePendingDestination()");
  });

  it("does not read the shortcut out of deprecated launch options", () => {
    // `launchOptions[.shortcutItem]` is deprecated as of iOS 26 in favour of
    // the UIScene lifecycle; the delegate callback covers both cases.
    expect(code(appDelegate)).not.toContain("launchOptions?[.shortcutItem]");
    expect(appDelegate).toContain("performActionFor shortcutItem: UIApplicationShortcutItem");
    expect(appDelegate).toContain("completionHandler(GearTrackerQuickAction.handle(shortcutItem))");
  });
});

describe("iOS Spotlight indexing", () => {
  const indexer = source("ios/Wisconsin/Core/SpotlightIndexer.swift");
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const home = source("ios/Wisconsin/Views/HomeView.swift");

  /**
   * Spotlight results are readable without unlocking the app, so the index
   * carries only the caller's own gear — never the team lists, and never the
   * shared item catalog.
   */
  it("indexes only the signed-in user's own bookings", () => {
    const indexerCode = code(indexer);
    expect(indexerCode).toContain("dashboard.myCheckouts.items + dashboard.myReservations");
    expect(indexerCode).not.toContain("teamCheckouts");
    expect(indexerCode).not.toContain("teamReservations");
    expect(indexerCode).not.toContain("overdueItems");
  });

  it("clears the index at the session boundary", () => {
    expect(app).toContain("SpotlightIndexer.clear()");
    expect(indexer).toContain("static func clear()");
    expect(indexer).toContain("deleteSearchableItems(withDomainIdentifiers: [domainIdentifier])");
  });

  /**
   * A returned booking drops out of the dashboard payload rather than being
   * reported as deleted, so an additive index would keep offering rows that
   * no longer exist.
   */
  it("replaces the domain rather than merging into it", () => {
    const apply = indexer.slice(indexer.indexOf("private static func apply("));
    expect(apply).toContain("try await index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier])");
    expect(apply).toContain("try await index.indexSearchableItems(");
    expect(indexer).toContain("item.expirationDate = booking.endsAt.addingTimeInterval(");
  });

  it("reuses the existing booking route for a Spotlight tap", () => {
    expect(app).toContain("onContinueUserActivity(CSSearchableItemActionType)");
    expect(app).toContain("appState.pendingPushBookingId = bookingId");
    expect(indexer).toContain("uniqueIdentifier: booking.id");
    expect(indexer).toContain("static func bookingId(from userInfo:");
  });

  it("refreshes from the same dashboard load as the widgets", () => {
    expect(home).toContain("SpotlightIndexer.index(from: loadedDashboard)");
    expect(home).toContain("GearWidgetPublisher.publish(from: loadedDashboard)");
  });

  it("stays silent when indexing fails", () => {
    // Spotlight is an accelerator; a failure must not reach the user.
    expect(indexer).toContain("} catch {");
    expect(indexer).not.toContain("self.error");
    expect(indexer).not.toContain("Haptics.error()");
  });
});
