import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS announcement splash", () => {
  it("reads the active announcement for iOS and dismisses through the idempotent route", () => {
    const client = source("ios/Wisconsin/Core/APIClient.swift");
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

  it("keeps the fixture scenarios out of release builds", () => {
    const harness = source("ios/Wisconsin/App/AnnouncementHarness.swift");
    expect(harness.startsWith("#if DEBUG")).toBe(true);
  });
});
