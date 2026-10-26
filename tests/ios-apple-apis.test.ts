import { describe, expect, it } from "vitest";
import { source, serviceModuleSource } from "./_helpers/source";

describe("iOS Apple API adoption", () => {
  it("lets overdue alerts arrive as time-sensitive", () => {
    const catalog = source("src/lib/notification-catalog.ts");
    const entitlements = source("ios/Wisconsin/Wisconsin.entitlements");
    const project = source("ios/project.yml");

    expect(catalog).toContain('standardInterruption: "time-sensitive"');
    expect(entitlements).toContain("com.apple.developer.usernotifications.time-sensitive");
    expect(project).toContain("com.apple.developer.usernotifications.time-sensitive: true");
  });

  it("extends a checkout from Siri with the sheet's limit and a confirmation", () => {
    const data = source("ios/Wisconsin/App/AppIntentsData.swift");
    const intents = source("ios/Wisconsin/App/AppIntents.swift");
    const sheet = source("ios/Wisconsin/Views/ExtendBookingSheet.swift");

    expect(data).toContain("struct ExtendCheckoutIntent: AppIntent");
    expect(data).toContain("try await requestConfirmation(");
    expect(data).toContain("ExtendWindow.latestEndsAt(nextNeedAt: insight.nextNeedAt)");
    expect(data).toContain("APIClient.shared.extendBooking(");
    expect(data).toContain('booking.allows("extend")');
    expect(data).not.toContain("openAppWhenRun");
    expect(intents).toContain("intent: ExtendCheckoutIntent()");
    // One rule for both surfaces.
    expect(sheet).toContain("enum ExtendWindow");
    expect(sheet).toContain("ExtendWindow.latestEndsAt(nextNeedAt: nextNeedAt)");
  });

  it("refreshes widgets and Spotlight in the background and clears it at sign-out", () => {
    const publisher = source("ios/Wisconsin/Widgets/GearWidgetPublisher.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const plist = source("ios/Wisconsin/Supporting/Info.plist");

    expect(publisher).toContain('static let identifier = "com.erikrole.Wisconsin.refresh"');
    expect(publisher).toContain("BGAppRefreshTaskRequest(identifier: identifier)");
    expect(app).toContain(".backgroundTask(.appRefresh(GearBackgroundRefresh.identifier))");
    expect(app).toContain("BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: GearBackgroundRefresh.identifier)");
    expect(plist).toContain("<string>com.erikrole.Wisconsin.refresh</string>");
    expect(plist).toContain("<string>fetch</string>");
  });

  it("keeps background refresh off the database overnight, like web polling", () => {
    const publisher = source("ios/Wisconsin/Widgets/GearWidgetPublisher.swift");

    expect(publisher).toContain("request.earliestBeginDate = earliestBegin(after: Date(timeIntervalSinceNow: interval))");
    expect(publisher).toContain("guard !isQuietHours(Date()) else { return }");
    expect(publisher.indexOf("guard !isQuietHours(Date())")).toBeLessThan(publisher.indexOf("APIClient.shared.dashboard()"));
    // Same 10 PM to 6 AM window as isOvernightQuietHours on the web.
    expect(publisher).toContain("static let quietHoursStart = 22");
    expect(publisher).toContain("static let quietHoursEnd = 6");
    expect(publisher).toContain("calendar.timeZone = NotificationPrefsViewModel.appTimeZone");
  });

  it("gives each Home Screen widget its own Smart Stack relevance", () => {
    const widgets = source("ios/WisconsinLiveActivities/GearHomeScreenWidgets.swift");
    const snapshot = source("ios/Wisconsin/Widgets/GearWidgetSnapshot.swift");

    expect(snapshot).toContain("func relevanceScore(for focus: GearWidgetFocus, at date: Date) -> Float");
    expect(widgets).toContain("GearWidgetProvider(focus: .shift)");
    expect(widgets).toContain("GearWidgetProvider(focus: .gear)");
    expect(widgets).toContain("TimelineEntryRelevance(score: score");
  });

  it("links Spotlight rows to the booking entity and hands off open bookings", () => {
    const entity = source("ios/Wisconsin/App/BookingEntity.swift");
    const spotlight = source("ios/Wisconsin/Core/SpotlightIndexer.swift");
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const plist = source("ios/Wisconsin/Supporting/Info.plist");

    expect(entity).toContain("struct BookingEntity: IndexedEntity");
    expect(spotlight).toContain("item.associateAppEntity(BookingEntity(summary: booking)");
    // Handoff never feeds search; the Spotlight index clears at sign-out.
    expect(entity).toContain("activity.isEligibleForSearch = false");
    expect(detail).toContain(".userActivity(BookingHandoff.activityType");
    expect(app).toContain(".onContinueUserActivity(BookingHandoff.activityType)");
    expect(plist).toContain("<string>com.erikrole.Wisconsin.booking</string>");
  });

  it("stamps pushes with the filter criteria the Focus filter matches", () => {
    const apns = source("src/lib/push/apns.ts");
    const notifications = serviceModuleSource("notifications");
    const blasts = source("src/lib/services/blasts.ts");
    const data = source("ios/Wisconsin/App/AppIntentsData.swift");

    expect(apns).toContain('"filter-criteria": opts.filterCriteria');
    expect(notifications).toContain("filterCriteria: entry?.group");
    expect(blasts).toContain('filterCriteria: "blast"');
    expect(data).toContain("struct CreativeFocusFilter: SetFocusFilterIntent");
    for (const group of ["gear", "schedule", "blast", "account", "admin"]) {
      expect(data).toContain(`case ${group}\n`);
    }
  });
});
