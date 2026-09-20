import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Settings hub", () => {
  it("presents Settings as a first-class surface from Profile", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(settings).toContain(".navigationTitle(\"Settings\")");
    expect(settings).toContain(".listStyle(.insetGrouped)");

    for (const section of [
      "Account & Security",
      "Notifications",
      "Theme",
      "Privacy Policy",
      "Contact Support",
      "Version",
      "Open iOS Settings",
      "Sign Out",
    ]) {
      expect(settings).toContain(section);
    }

    expect(settings).toContain("SettingsRow(");
    expect(settings).not.toContain("Staff Tools");
    expect(settings).not.toContain("AppIconSettingsView");
    expect(settings).not.toContain('SettingsRow(title: "App Icon"');
  });

  it("keeps retired staff utilities out of the launch Settings surface", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(settings).not.toContain("isStaffOrAdmin");
    expect(settings).not.toContain("Link Sticker Codes");
    expect(settings).not.toContain("Scanner Debugger");
    expect(settings).not.toContain("Staff Tools");
    expect(settings).not.toContain("LinkStickerWizard");
    expect(settings).not.toContain("ScannerDebuggerView");
  });

  it("keeps Settings Directory as a fallback for Browse destinations", () => {
    const appTab = source("ios/Wisconsin/Views/AppTabView.swift");
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(appTab).toContain("TabSection(\"Resources\")");
    expect(appTab).toContain('Tab("Guides", systemImage: "book.closed", value: 6)');
    expect(appTab).toContain('Tab("Users", systemImage: "person.2", value: 5)');
    expect(appTab).toContain('Tab("Licenses", systemImage: "key", value: 7)');
    expect(browse).toContain("GuidesView(wrapsInNavigationStack: false)");
    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
    expect(browse).toContain("UsersView(wrapsInNavigationStack: false)");
  });

  it("keeps notification and app settings honest at the menu level", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");
    const notifications = source("ios/Wisconsin/Views/NotificationSettingsView.swift");

    expect(notifications).toContain("title: \"Delivery status\"");
    expect(notifications).toContain("notificationSummaryText");
    expect(notifications).toContain("pushStatusText");
    expect(notifications).toContain("case .denied:");
    expect(notifications).toContain("\"iOS off\"");
    expect(notifications).toContain("Text(\"In-app notifications always show in your inbox, regardless of these settings.\")");

    expect(settings).toContain("SettingsRow(title: \"Theme\"");
    expect(settings).toContain("Text(choice.label)");
    expect(settings).not.toContain("Label(choice.label, systemImage:");
    expect(settings).toContain(".preferredColorScheme(themeChoice.colorScheme)");
    expect(settings).toContain("SettingsRow(title: \"Open iOS Settings\"");
    expect(settings).toContain("Button(\"Sign Out\", role: .destructive)");
  });

  it("ships one primary app icon without alternate-icon switching", () => {
    const project = source("ios/project.yml");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(project).toContain("ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon");
    expect(project).not.toContain("ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES");
    expect(settings).not.toContain("setAlternateIconName");
    expect(settings).not.toContain("AppIconSettingsView");
  });
});
