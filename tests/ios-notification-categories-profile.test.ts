import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function bodyBetween(text: string, startNeedle: string, endNeedle: string) {
  const start = text.indexOf(startNeedle);
  const end = text.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

const categories = [
  { key: "checkoutDue", label: "Checkout due reminders" },
  { key: "checkoutOverdue", label: "Checkout overdue alerts" },
  { key: "reservation", label: "Reservation updates" },
  { key: "licenseExpiry", label: "License expiry reminders" },
  { key: "schedule", label: "Schedule updates" },
  { key: "trade", label: "Trade updates" },
  { key: "gearPrep", label: "Gear prep nudges" },
] as const;

describe("iOS notification category preferences", () => {
  it("keeps the API, native model, and web labels aligned", () => {
    const route = source("src/app/api/me/notification-preferences/route.ts");
    const catalog = source("src/lib/notification-catalog.ts");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const webSettings = source("src/app/(app)/settings/notifications/page.tsx");

    for (const { key, label } of categories) {
      // The catalog owns ids and labels; the route accepts every catalog id.
      expect(catalog).toContain(`id: "${key}",\n    label: "${label}",`);
      expect(models).toContain(`var ${key}: Bool`);
      expect(webSettings).toContain(`label="${label}"`);
      expect(webSettings).toContain(`setCategory("${key}", v)`);
    }

    // Omitted fields keep their stored value; a schema default would reset them.
    expect(route).not.toContain(".default(");
    expect(route).toContain("NOTIFICATION_CATEGORIES.map((c) => [c, z.boolean().optional()])");
    expect(route).toContain("updateUserPrefs(user.id, {");
    expect(models).toContain("var categories: Categories? = nil");
    expect(models).toContain("try container.encodeIfPresent(categories, forKey: .categories)");
  });

  it("lets native Notifications edit each category while exposing account pause state", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const preferences = source("ios/Wisconsin/Core/Preferences.swift");

    expect(detail).toContain("Text(\"Notification Types\")");
    expect(detail).toContain("Text(\"In-app notifications always show in your inbox, regardless of these settings.\")");
    expect(detail).toContain("private var quietHoursSection");
    expect(detail).toContain("pauseButton(title: \"Pause 1 hour\"");
    expect(detail).toContain("pauseButton(title: \"Pause 1 day\"");
    expect(detail).toContain("pauseButton(title: \"Pause 1 week\"");
    expect(detail).toContain("Label(\"Resume now\", systemImage: \"bell.fill\")");
    expect(detail).toContain("await prefsVM.pause(for: seconds)");
    expect(detail).toContain("await prefsVM.resume()");

    for (const { key, label } of categories) {
      expect(detail).toContain(`title: "${label}"`);
      expect(detail).toContain(`category: .${key}`);
    }

    expect(detail).toContain("Text(\"Notification Types\")");
    expect(detail).toContain("Text(\"In-app notifications always show in your inbox, regardless of these settings.\")");

    const categoryToggle = bodyBetween(detail, "private func categoryToggle", "private var notificationSummaryText");
    expect(categoryToggle).toContain("prefsVM.categoryValue(category)");
    expect(categoryToggle).toContain("await prefsVM.setCategory(category, value: value)");
    expect(categoryToggle).toContain("prefsVM.isPaused");

    expect(preferences).toContain("enum Category { case checkoutDue, checkoutOverdue, reservation, licenseExpiry, schedule, trade, gearPrep }");
    expect(preferences).toContain("private static let defaultCategories = NotificationPreferences.Categories(");
    for (const { key } of categories) {
      expect(preferences).toContain(`${key}: true`);
      expect(preferences).toContain(`case .${key}:`);
      expect(preferences).toContain(`categories.${key} = value`);
    }
    expect(preferences).toContain("current.categories = categories");
    expect(preferences).toContain("await save(current, fallbackTo: prev)");
    expect(preferences).toContain("error = nil");
  });

  it("renders server catalog levels, quiet hours, and extended pause on iOS", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const preferences = source("ios/Wisconsin/Core/Preferences.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const api = source("ios/Wisconsin/Core/APIClient.swift");

    // Levels come from the role-filtered catalog; older servers fall back to toggles.
    expect(models).toContain("enum NotificationPushLevel: String, Codable, CaseIterable, Identifiable");
    expect(models).toContain("self = NotificationPushLevel(rawValue: raw) ?? .standard");
    expect(models).toContain("var push: [String: NotificationPushLevel]? = nil");
    expect(models).toContain("var quietHours: NotificationQuietHours? = nil");
    expect(api).toContain('request(path: "/api/me/notification-preferences", method: "PATCH")');
    expect(preferences).toContain("var supportsLevels: Bool { !catalog.isEmpty }");
    expect(preferences).toContain("patch: .init(push: [entry.id: level])");
    expect(detail).toContain("if prefsVM.supportsLevels {\n                    categoryLevelSections");
    expect(detail).toContain(".pickerStyle(.menu)");

    // Partial saves: resume sends an explicit null, never the whole record.
    expect(models).toContain("var pausedUntil: String?? = nil");
    expect(preferences).toContain("patch: .init(pausedUntil: .some(nil))");

    // Quiet hours edit in Central Time and debounce time-wheel saves.
    expect(detail).toContain(".environment(\\.timeZone, NotificationPrefsViewModel.appTimeZone)");
    expect(preferences).toContain("try? await Task.sleep(for: .milliseconds(700))");
    expect(detail).toContain('Text("Let urgent alerts through")');
    expect(detail).toContain(".accessibilityAddTraits(selected ? .isSelected : [])");

    // Pause offers a morning and a custom end.
    expect(detail).toContain('Text("Pause until tomorrow morning")');
    expect(detail).toContain('Text("Pause until…")');
    expect(preferences).toContain("func pause(until: Date) async");
  });

  it("opens notification settings from iOS Settings, the inbox, and links", () => {
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const prompt = source("ios/Wisconsin/Views/PushPrePromptView.swift");
    const route = source("ios/Wisconsin/Core/GearTrackerRoute.swift");
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const inbox = source("ios/Wisconsin/Views/NotificationsSheet.swift");
    const actions = source("ios/Wisconsin/App/NotificationActions.swift");

    // iOS Settings shows "Notification Settings" only when the app asks for it.
    expect(delegate).toContain("[.alert, .badge, .sound, .providesAppNotificationSettings]");
    expect(prompt).toContain("requestAuthorization(options: PushAuthorization.options)");
    expect(app).toContain("settings.providesAppNotificationSettings == false");
    expect(delegate).toContain("openSettingsFor notification: UNNotification?");
    expect(delegate).toContain("sharedAppState?.apply(.notificationSettings)");

    // One route, reused by links, the inbox, and iOS Settings.
    expect(route).toContain('return id == "notifications" ? .notificationSettings : nil');
    expect(route).toContain('return URL(string: "wisconsin://settings/notifications")');
    expect(appState).toContain("pendingSettingsDestination = .notifications");
    expect(home).toContain("navigationPath.append(ProfileRoute(initialDestination: destination))");
    expect(inbox).toContain("onRoute?(.notificationSettings)");
    expect(inbox).toContain('Label("Notification Settings", systemImage: "gearshape")');

    // The inbox dates rows the way the web does.
    expect(inbox).toContain("cal.isDateInToday(n.displayDate)");

    // No action identifier the app never registers.
    expect(actions).not.toContain("GT_VIEW");
  });

  it("clears delivered alerts when their inbox rows are read", () => {
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const inbox = source("ios/Wisconsin/Views/NotificationsSheet.swift");

    expect(delegate).toContain('($0.request.content.userInfo["notificationId"] as? String).map(ids.contains)');
    expect(delegate).toContain("completionHandler([.banner, .list, .badge])");
    expect(inbox).toContain("await clearDelivered([id])");
    expect(inbox).toContain("await clearDelivered(nil)");
  });
});
