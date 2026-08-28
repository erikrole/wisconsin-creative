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

describe("iOS notification long-press actions", () => {
  const actions = source("ios/Wisconsin/App/NotificationActions.swift");
  const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
  const apns = source("src/lib/push/apns.ts");
  const notifications = source("src/lib/services/notifications.ts");
  const blasts = source("src/lib/services/blasts.ts");

  it("sends an APNs category the client registers under the same name", () => {
    expect(apns).toContain('...(opts.category ? { category: opts.category } : {})');
    expect(notifications).toContain("const APNS_ACTION_CATEGORY");
    expect(blasts).toContain('category: "GT_BLAST"');

    // Every identifier the server can send must exist on the client, or the
    // notification renders with no actions at all.
    const serverCategories = [
      ...notifications.matchAll(/"(GT_[A-Z_]+)"/g),
      ...blasts.matchAll(/"(GT_[A-Z_]+)"/g),
    ].map((m) => m[1]);
    expect(serverCategories.length).toBeGreaterThan(0);
    for (const category of new Set(serverCategories)) {
      expect(actions).toContain(`= "${category}"`);
    }
    expect(delegate).toContain("GearTrackerNotificationCategory.register()");
  });

  /**
   * `WisconsinApp.onOpenURL` refuses to route a tapped link into Extend,
   * because extending is a decision taken deliberately on the booking page. A
   * lock-screen button is a weaker signal of intent than a tapped link, so the
   * same rule has to hold for notification actions.
   */
  it("never routes a notification action into a mutation sheet", () => {
    const actionsCode = code(actions);
    expect(actionsCode).not.toContain("Extend");
    expect(actionsCode).not.toContain("pendingExtendBookingId");
    expect(code(delegate)).not.toContain("pendingExtendBookingId");
    // Every foreground action shares one routing path with the plain tap.
    expect(delegate).toContain("private func routeNotificationDestination(");
    expect(delegate).toContain(
      "routeNotificationDestination(userInfo: userInfo, notificationBoundary: notificationBoundary)",
    );
  });

  it("offers exactly one server write, and only the idempotent one", () => {
    // "Got it" is the acknowledgement -- the same call the in-app banner makes.
    expect(actions).toContain('case acknowledgeBlast = "GT_ACK_BLAST"');
    expect(delegate).toContain("APIClient.shared.acknowledgeBlast(id: blastId)");
    // No other API call reachable from a notification action.
    const handler = delegate.slice(
      delegate.indexOf("switch GearTrackerNotificationAction(rawValue:"),
      delegate.indexOf("private func routeNotificationDestination("),
    );
    const apiCalls = [...handler.matchAll(/APIClient\.shared\.(\w+)/g)].map((m) => m[1]);
    expect(apiCalls).toEqual(["acknowledgeBlast"]);
  });

  it("keeps snooze entirely on the device", () => {
    const snooze = actions.slice(actions.indexOf("enum NotificationSnooze"));
    expect(snooze).toContain("UNTimeIntervalNotificationTrigger");
    expect(snooze).not.toContain("APIClient");
    // Derived from the original request id, so a second snooze replaces rather
    // than stacks another copy of the same alert.
    expect(snooze).toContain('identifier: "gt-snooze-\\(payload.identifier)"');
  });

  /**
   * `UNNotification` is not Sendable and `userInfo` is `[AnyHashable: Any]`;
   * both are lifted into a Sendable payload on the delegate's actor. That also
   * bounds where a reminder can route: only keys the original carried.
   */
  it("carries only Sendable routing keys across the isolation boundary", () => {
    expect(actions).toContain("struct Payload: Sendable");
    expect(actions).toContain('static let routingKeys = ["bookingId", "eventId", "blastId"]');
    expect(actions).toContain("let routing: [String: String]");
    expect(delegate).toContain("NotificationSnooze.Payload(notification: response.notification)");
  });

  it("does not treat a dismissal as a destination", () => {
    expect(delegate).toContain("response.actionIdentifier != UNNotificationDismissActionIdentifier");
  });

  it("keeps the read-only preview and session boundary guards on every action", () => {
    const handler = delegate.slice(delegate.indexOf("didReceive response:"));
    expect(handler).toContain("guard PushTokenStorage.registrationAllowed else {");
    expect(handler).toContain("authSessionBoundary.owns(notificationBoundary)");
  });
});

describe("iOS in-app long press", () => {
  const notificationsSheet = source("ios/Wisconsin/Views/NotificationsSheet.swift");
  const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
  const items = source("ios/Wisconsin/Views/ItemsView.swift");
  const licenses = source("ios/Wisconsin/Views/LicensesView.swift");

  /**
   * A row that offers an action by swipe but not by long press teaches people
   * to distrust both gestures. Where a surface has one, it has the other.
   */
  it("keeps swipe and long press in agreement on notification rows", () => {
    expect(notificationsSheet).toContain(".swipeActions(edge: .leading)");
    expect(notificationsSheet).toContain(".contextMenu {");
    const menu = notificationsSheet.slice(notificationsSheet.indexOf(".contextMenu {"));
    expect(menu).toContain('Label("Mark Read", systemImage: "checkmark")');
    expect(menu).toContain("vm.markRead(id: notif.id)");
  });

  it("gives a search result the same menu the items list carries", () => {
    const searchMenu = search.slice(search.indexOf(".contextMenu {"));
    expect(searchMenu).toContain('Label("Reserve", systemImage: "plus.circle")');
    expect(searchMenu).toContain('Label("Copy Asset Tag", systemImage: "doc.on.doc")');
    // Same wording as the Items list, so the gesture transfers between them.
    expect(items).toContain('Label("Reserve", systemImage: "plus.circle")');
    expect(items).toContain('Label("Copy Asset Tag", systemImage: "doc.on.doc")');
    // Retired gear is not reservable from either surface.
    expect(searchMenu).toContain("asset.computedStatus != .retired");
    // The sheet closes first so the composer does not open behind it.
    expect(search).toContain("private func startReservation(for asset: Asset)");
    const start = search.slice(search.indexOf("private func startReservation(for asset: Asset)"));
    expect(start.indexOf("dismiss()")).toBeLessThan(start.indexOf("drafts.start("));
  });

  /**
   * The row hides an unclaimed code behind "Code hidden until claimed". Long
   * press must be gated on the same condition, or the gesture becomes a way
   * around the rule the visible line enforces.
   */
  it("never copies a license code the row is hiding", () => {
    const menu = licenses.slice(licenses.indexOf(".contextMenu {"));
    expect(menu).toContain("if canRevealCode, !code.code.isEmpty {");
    expect(menu).toContain('Label("Copy License Code", systemImage: "doc.on.doc")');
    expect(licenses).toContain('canRevealCode && !code.code.isEmpty ? code.code : "Code hidden until claimed"');
  });
});

describe("iOS Home Screen menu state", () => {
  const quickActions = source("ios/Wisconsin/App/QuickActions.swift");
  const home = source("ios/Wisconsin/Views/HomeView.swift");

  it("labels the icon menu from the snapshot the widgets read", () => {
    expect(quickActions).toContain("func subtitle(for snapshot: GearWidgetSnapshot) -> String");
    expect(quickActions).toContain("snapshot.overdueCount > 0");
    expect(quickActions).toContain("snapshot.dueTodayCount > 0");
    expect(quickActions).toContain("snapshot.nextShift");
    expect(home).toContain("GearTrackerQuickAction.refreshSubtitles(");
    expect(home).toContain("GearWidgetPublisher.snapshot(from: loadedDashboard)");
  });

  /**
   * The role filter in `refresh(for:)` decides which shortcuts exist. A
   * subtitle refresh maps over what is installed so it can never reintroduce
   * one the role filter removed.
   */
  it("cannot reintroduce a shortcut the role filter removed", () => {
    const refresh = quickActions.slice(quickActions.indexOf("static func refreshSubtitles("));
    expect(refresh).toContain("let existing = UIApplication.shared.shortcutItems ?? []");
    expect(refresh).toContain("existing.map { item in");
    expect(refresh).not.toContain("allCases");
  });

  it("falls back to describing the destination when there is nothing to report", () => {
    // "0 overdue" is worse than "Checkouts and reservations".
    const subtitleFn = quickActions.slice(
      quickActions.indexOf("func subtitle(for snapshot:"),
      quickActions.indexOf("func shortcutItem("),
    );
    expect(subtitleFn).toContain("return subtitle");
  });
});
