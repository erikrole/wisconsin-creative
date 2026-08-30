import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

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
    const models = source("ios/Wisconsin/Models/Models.swift");
    const webSettings = source("src/app/(app)/settings/notifications/page.tsx");

    for (const { key, label } of categories) {
      expect(route).toContain(`${key}: z.boolean().default(true)`);
      expect(models).toContain(`var ${key}: Bool`);
      expect(webSettings).toContain(`label="${label}"`);
      expect(webSettings).toContain(`setCategory("${key}", v)`);
    }

    expect(route).toContain("schedule: true");
    expect(route).toContain("trade: true");
    expect(route).toContain("gearPrep: true");
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
});
