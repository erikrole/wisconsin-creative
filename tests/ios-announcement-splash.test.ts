import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("iOS announcement splash", () => {
  it("reads the active announcement for iOS and dismisses through the idempotent route", () => {
    const client = apiClientSource();
    expect(client).toContain('path: "/api/announcements/active"');
    expect(client).toContain('URLQueryItem(name: "platform", value: "ios")');
    expect(client).toContain('"/api/announcements/\\(id)/dismiss", method: "POST"');
  });

  it("skips unknown block types instead of failing the splash", () => {
    const models = source("ios/Wisconsin/Models/AnnouncementModels.swift");
    expect(models).toContain('case "paragraph"');
    expect(models).toContain('case "list"');
    expect(models).toContain("default:\n                block = nil");
    expect(models).toContain(".compactMap(\\.block)");
  });

  it("loads on launch and foreground with no timer, never for collaborators or role preview", () => {
    const sheet = source("ios/Wisconsin/Views/Announcements/AnnouncementSplashSheet.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    expect(sheet).toContain("phase == .active");
    expect(sheet).not.toContain("Timer");
    expect(sheet).toContain("guard announcement.remaining > 0");
    expect(app).toContain(".announcementSplash(eligibilityKey: announcementEligibilityKey)");
    const eligibility = app.slice(app.indexOf("private var announcementEligibilityKey"));
    expect(eligibility.slice(0, 500)).toContain('user.role != "COLLABORATOR"');
    expect(eligibility.slice(0, 500)).toContain("!user.isReadOnlyRolePreview");
  });

  it("routes app-path buttons through the shared parser before falling back to the website", () => {
    const sheet = source("ios/Wisconsin/Views/Announcements/AnnouncementSplashSheet.swift");
    expect(sheet).toContain("GearTrackerRouteParser.parsePath");
    expect(sheet).toContain("appState.apply(route)");
    expect(sheet).toContain('hasPrefix("/")');
  });

  it("uses the fixed Wisconsin red for the splash and leaves brandPrimary alone", () => {
    const brand = source("ios/Wisconsin/Core/Brand.swift");
    const sheet = source("ios/Wisconsin/Views/Announcements/AnnouncementSplashSheet.swift");
    expect(brand).toContain("static let wisconsinRed = Color(red: 200.0 / 255.0, green: 0, blue: 0)");
    expect(brand).toContain("static let brandPrimary = Color(UIColor(dynamicProvider:");
    expect(sheet).toContain(".tint(.wisconsinRed)");
    expect(sheet).not.toContain("brandPrimary");
    expect(sheet).toContain("colorScheme == .dark ? Color(red: 1.0, green: 0.38, blue: 0.36)");
  });

  it("keeps the fixture scenarios out of release builds", () => {
    const harness = source("ios/Wisconsin/App/AnnouncementHarness.swift");
    expect(harness.startsWith("#if DEBUG")).toBe(true);
  });

  it("remembers a dismissal on the phone and retries one the server never received", () => {
    const sheet = source("ios/Wisconsin/Views/Announcements/AnnouncementSplashSheet.swift");
    const memory = source("ios/Wisconsin/Core/AnnouncementDismissalMemory.swift");
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    // Recorded before the request, so a failed POST cannot bring the splash back.
    expect(sheet).toContain("AnnouncementDismissalMemory.recordDismissed(announcement.id, scope: scope)");
    expect(sheet).toContain("await retryPendingDismissals(scope: scope)");
    expect(sheet).toContain("AnnouncementDismissalMemory.isDismissed(next.id, scope: scope)");
    expect(sheet).toContain("catch APIError.notFound");
    expect(memory).toContain("static func markPending(");
    expect(memory).toContain("stored.scope == scope");
    // Per-account memory leaves with the account.
    expect(app).toContain("AnnouncementDismissalMemory.clear()");
  });
});
