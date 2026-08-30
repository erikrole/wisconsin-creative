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

describe("iOS Settings detail menus", () => {
  it("keeps root Settings as a navigation hub for account and notifications", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");
    const profileBody = bodyBetween(profile, "struct ProfileView: View", "struct SettingsMenuRow");

    expect(profile).toContain("case notifications");
    expect(profile).toContain("case accountSecurity");
    expect(profileBody).toContain("destinationView(for: dest)");
    expect(profileBody).toContain("NotificationSettingsView(");
    expect(profileBody).toContain("AccountSecuritySettingsView(manageAccountURL: Self.manageAccountURL)");

    expect(settings).toContain("NavigationLink(value: ProfileDestination.accountSecurity)");
    expect(settings).toContain("SettingsRow(title: \"Account & Security\"");
    expect(settings).toContain("NavigationLink(value: ProfileDestination.notifications)");
    expect(settings).toContain("SettingsRow(title: \"Notifications\"");
    expect(settings).toContain("notificationStatusText");
    expect(settings).not.toContain("categoryToggle(");
    expect(settings).not.toContain("channelToggle(");
    expect(settings).not.toContain("pauseChip(");
  });

  it("keeps the native Notifications detail push-only for launch", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");

    expect(detail).toContain(".navigationTitle(\"Notifications\")");
    expect(detail).toContain("title: \"Delivery status\"");
    expect(detail).toContain("pushPermissionRow");
    expect(detail).toContain("Text(\"In-app notifications always show in your inbox, regardless of these settings.\")");
    expect(detail).toContain("title: \"Push alerts\"");
    expect(detail).toContain("Text(\"Notification Types\")");
    expect(detail).toContain("Text(\"Quiet hours\")");
    expect(detail).toContain("pauseButton(title: \"Pause 1 hour\"");
    expect(detail).toContain("Label(\"Resume now\", systemImage: \"bell.fill\")");

    for (const category of [
      ".checkoutDue",
      ".checkoutOverdue",
      ".reservation",
      ".licenseExpiry",
      ".schedule",
      ".trade",
      ".gearPrep",
    ]) {
      expect(detail).toContain(`category: ${category}`);
    }

    expect(detail).toContain("await prefsVM.setChannel(.push, value: v)");
    expect(detail).toContain("await prefsVM.setCategory(category, value: value)");
    expect(detail).toContain(".tint(Color.statusText(.green))");
    expect(detail).toContain(".accessibilityHint(");
    expect(detail).toContain(": description");
    expect(detail).toContain("Push alerts go to devices signed in to this account. The test checks this device only.");
    expect(detail).toContain("Choose which push alerts can reach you.");
    expect(detail).toContain("Text(\"Send Test Notification\")");
    expect(detail).toContain("APIClient.shared.sendTestPush(deviceToken: currentPushToken)");
    expect(detail).toContain("No registered device was found. Retry push registration above.");
    expect(detail).not.toContain("Pause Alerts");
    expect(detail).not.toContain("Email alerts");
    expect(detail).not.toContain("currentEmail");
    expect(detail).not.toContain("notificationToggleLabel");
  });

  it("uses compact colored root rows with truthful destination accessories", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(settings).toContain("private struct SettingsRow<Trailing: View>: View");
    expect(settings).toContain("@ScaledMetric(relativeTo: .body) private var iconSize = 30");
    expect(settings).toContain(".background(color, in: RoundedRectangle");
    expect(settings).toContain("NavigationLink(value: ProfileDestination.accountSecurity)");
    expect(settings).toContain("NavigationLink(value: ProfileDestination.notifications)");
    expect(settings).toContain('Image(systemName: "arrow.up.right.square")');
  });

  it("adds a native Account & Security password workflow backed by the existing API", () => {
    const accountDetail = source("ios/Wisconsin/Views/AccountSecuritySettingsView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/me/change-password/route.ts");

    expect(accountDetail).toContain(".navigationTitle(\"Account & Security\")");
    expect(accountDetail).toContain("title: \"Manage profile on web\"");
    expect(accountDetail).toContain("Current password");
    expect(accountDetail).toContain("New password");
    expect(accountDetail).toContain("Confirm new password");
    expect(accountDetail).toContain("Toggle(\"Sign out other devices after changing password\", isOn: $revokeOtherSessions)");
    expect(accountDetail).toContain('Text("Applies only to this password change.")');
    expect(accountDetail).toContain(".tint(Color.statusText(.green))");
    expect(accountDetail).toContain("showPasswords.toggle()");
    expect(accountDetail).toContain("newPassword.count >= 8");
    expect(accountDetail).toContain("currentPassword != newPassword");
    expect(accountDetail).toContain("APIClient.shared.changePassword(");
    expect(accountDetail).toContain("revokeOtherSessions: revokeOtherSessions");
    expect(accountDetail).toContain("Password changed. Other devices were signed out.");

    expect(apiClient).toContain("func changePassword(currentPassword: String, newPassword: String, revokeOtherSessions: Bool = true) async throws");
    expect(apiClient).toContain("request(path: \"/api/me/change-password\", method: \"POST\")");
    expect(apiClient).toContain("let revokeOtherSessions: Bool");
    expect(route).toContain("newPassword: z.string().min(8");
    expect(route).toContain("revokeOtherSessions: z.boolean().default(false)");
    expect(route).toContain("New password must be different from the current password.");
  });

  it("uses the authenticated APNs self-test contract", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/devices/test/route.ts");

    expect(detail).toContain("await APIClient.shared.sendTestPush(deviceToken: currentPushToken)");
    expect(apiClient).toContain("struct TestPushResult: Decodable");
    expect(apiClient).toContain('request(path: "/api/devices/test", method: "POST")');
    expect(apiClient).toContain("req.httpBody = try JSONEncoder().encode(Body(token: deviceToken))");
    expect(route).toContain("export const POST = withAuth");
    expect(route).toContain("token: body.token");
    expect(route).toContain('title: "Test notification"');
    expect(route).toContain("return ok({ delivered, devices: tokens.length, revoked: revoked.length })");
  });

  it("exposes App Review privacy, support, and self-service deletion controls", () => {
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");
    const accountDetail = source("ios/Wisconsin/Views/AccountSecuritySettingsView.swift");
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const route = source("src/app/api/me/account/route.ts");

    expect(settings).toContain("SettingsRow(title: \"Privacy Policy\"");
    expect(settings).toContain("SettingsRow(title: \"Contact Support\"");
    expect(accountDetail).toContain("Button(\"Delete Account\", role: .destructive)");
    expect(accountDetail).toContain("SecureField(\"Current password\"");
    expect(accountDetail).toContain("APIClient.shared.deleteAccount(currentPassword: currentPassword)");
    expect(apiClient).toContain("request(path: \"/api/me/account\", method: \"DELETE\")");
    expect(route).toContain("deactivateUserWithCleanup");
    expect(route).toContain('action: "account_self_deleted"');
  });
});
