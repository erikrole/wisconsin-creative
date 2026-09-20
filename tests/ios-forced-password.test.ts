import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS forced password setup", () => {
  it("decodes forcePasswordChange without breaking older auth payloads", () => {
    const models = source("ios/Wisconsin/Models/Models.swift");

    expect(models).toContain("let forcePasswordChange: Bool");
    expect(models).toContain("decodeIfPresent(Bool.self, forKey: .forcePasswordChange) ?? false");
  });

  it("uses the allowed self-service password route and refreshes current user state", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const sessionStore = source("ios/Wisconsin/Core/SessionStore.swift");

    expect(apiClient).toContain("func changePassword(currentPassword: String, newPassword: String, revokeOtherSessions: Bool = true)");
    expect(apiClient).toContain("request(path: \"/api/me/change-password\", method: \"POST\")");
    expect(apiClient).toContain("let _: ChangePasswordResponse = try await perform(req)");
    expect(sessionStore).toContain("func completeForcedPasswordChange(currentPassword: String, newPassword: String) async");
    expect(sessionStore).toContain("try await APIClient.shared.changePassword");
    expect(sessionStore).toContain("let user = try await APIClient.shared.me()");
    expect(sessionStore).toContain("guard authRequests.owns(requestToken) else { return }");
    expect(sessionStore).toContain("currentUser = user");
  });

  it("keeps forced users out of the app shell until the flag clears", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const setupView = source("ios/Wisconsin/Views/PasswordSetupView.swift");

    expect(app).toContain("user.forcePasswordChange");
    expect(app).toContain("PasswordSetupView(email: user.email)");
    expect(app).toContain("session.currentUser?.forcePasswordChange == false");
    expect(setupView).toContain("Set your password");
    expect(setupView).toContain("await session.completeForcedPasswordChange");
    expect(setupView).toContain("Task { await session.logout() }");
  });

  it("keeps password requirements visible while users complete first sign-in", () => {
    const setupView = source("ios/Wisconsin/Views/PasswordSetupView.swift");

    expect(setupView).toContain("PasswordRequirementChecklist(requirements: passwordRequirements)");
    expect(setupView).toContain("Temporary password entered");
    expect(setupView).toContain("At least 8 characters");
    expect(setupView).toContain("Passwords match");
    expect(setupView).toContain("Different from temporary password");
    expect(setupView).toContain("not met");
  });

  it("names the password visibility control by action and state", () => {
    const setupView = source("ios/Wisconsin/Views/PasswordSetupView.swift");

    expect(setupView).toContain('.accessibilityLabel(showPasswords ? "Hide passwords" : "Show passwords")');
    expect(setupView).toContain('.accessibilityValue(showPasswords ? "Passwords visible" : "Passwords hidden")');
  });
});
