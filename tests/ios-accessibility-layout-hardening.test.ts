import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS accessibility-size layout hardening", () => {
  it("gives Welcome headers and paired fields accessibility-size layouts", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");
    const coordinator = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");

    expect(welcome).toContain("struct WelcomeHeaderView: View");
    expect(welcome).toContain("if dynamicTypeSize.isAccessibilitySize");
    expect(welcome).toContain("struct WelcomeFieldLabel: View");
    expect(welcome).toContain("private var graduationFields: some View");
    expect(coordinator).toContain("Text(stepTitle)");
    expect(coordinator).toContain(".fixedSize(horizontal: false, vertical: true)");
  });

  it("keeps shared Settings and Browse icons bounded and moves accessories below large labels", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(profile).toContain("private var renderedSize: CGFloat { min(iconSize, 44) }");
    expect(profile).toContain("private var rowCopy: some View");
    expect(profile).toContain("trailing()");
    expect(profile).toContain(".frame(maxWidth: .infinity, alignment: .trailing)");
    expect(settings).toContain("private var renderedIconSize: CGFloat { min(iconSize, 40) }");
    expect(settings).toContain("private var rowTitle: some View");
  });

  it("stacks profile identity and account identity at accessibility sizes", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    const account = source("ios/Wisconsin/Views/AccountSecuritySettingsView.swift");

    expect(profile).toContain("private var profileIdentity: some View");
    expect(profile).toContain("dynamicTypeSize.isAccessibilitySize");
    expect(account).toContain("private var accountIdentity: some View");
    expect(account).toContain(".tint(Color.brandPrimary)");

    // The three-up metric rank this used to guard is gone -- it ranked "Push",
    // a preference, alongside two counts. Next Up replaced it, and its rows are
    // a single column that reflows without a size branch.
    expect(profile).not.toContain("private var statusMetrics");
    expect(profile).not.toContain("SettingsStatusMetric");
  });

  it("keeps launch notification controls native and free of retired pause layouts", () => {
    const notifications = source("ios/Wisconsin/Views/NotificationSettingsView.swift");

    expect(notifications).toContain("Toggle(isOn: binding)");
    expect(notifications).toContain("title: \"Push alerts\"");
    expect(notifications).not.toContain("pauseChip(");
    expect(notifications).not.toContain("Pause Alerts");
  });

  it("uses a dedicated accessibility-size booking card composition", () => {
    const bookings = source("ios/Wisconsin/Views/BookingsView.swift");

    expect(bookings).toContain("private func accessibilityRow(now: Date) -> some View");
    expect(bookings).toContain("private func compactRow(now: Date) -> some View");
    expect(bookings).toContain("timingLine(now: now, lineLimit: nil)");
    expect(bookings).toContain("metadataLine(lineLimit: nil)");
  });

  it("keeps item identity ahead of status badges at accessibility sizes", () => {
    const items = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(items).toContain("struct AssetRow: View");
    expect(items).toContain("private var accessibilityRow: some View");
    expect(items).toContain("assetCopy(lineLimit: nil)");
    expect(items).toContain("familyCopy(lineLimit: nil)");
    expect(items).toContain("dynamicTypeSize.isAccessibilitySize ? .infinity : 140");
  });
});
