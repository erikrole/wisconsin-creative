import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("iOS native login recovery flows", () => {
  const source = readFileSync("ios/Wisconsin/Views/LoginView.swift", "utf8");
  const authViews = readFileSync("ios/Wisconsin/Views/NativeAuthViews.swift", "utf8");
  const apiClient = apiClientSource();

  it("presents native registration and recovery screens from login", () => {
    expect(source).not.toContain("SafariServices");
    expect(source).not.toContain("SFSafariViewController");
    expect(source).toContain("NativeForgotPasswordView(initialEmail: email)");
    expect(source).toContain("authDestination = .forgotPassword(email: trimmedEmail)");
    expect(authViews).toContain('init(initialEmail: String = "")');
    expect(authViews).toContain("_email = State(initialValue: normalizedEmail)");
    expect(source).toContain("NativeRegistrationView(initialEmail: email)");
    expect(source).toContain(".sheet(item: $authDestination)");
    expect(source).toContain('Button("Forgot password?")');
    expect(source).toContain("authDestination = .forgotPassword");
    expect(source).not.toContain('Button("Need an account?")');
    expect(source).toContain("APIClient.shared.discoverAuth(email: submittedEmail)");
    expect(source).toContain("authDestination = .register(email: submittedEmail)");
    expect(source).not.toContain('Link("Forgot password?", destination:');
    expect(source).not.toContain('Link("Need an account?", destination:');
  });

  it("uses the existing native auth API contracts", () => {
    expect(authViews).toContain("struct NativeRegistrationView: View");
    expect(authViews).toContain("struct NativeForgotPasswordView: View");
    expect(authViews).toContain("session.register(");
    expect(authViews).toContain("APIClient.shared.requestPasswordReset");
    expect(apiClient).toContain('request(path: "/api/auth/register", method: "POST")');
    expect(apiClient).toContain('request(path: "/api/auth/discover", method: "POST")');
    expect(apiClient).toContain('request(path: "/api/auth/forgot-password", method: "POST")');
    expect(apiClient).toContain("prepareAuthHost(for: email)");
  });

  it("names the password visibility control by action and state", () => {
    expect(source).toContain('.accessibilityLabel(showPassword ? "Hide password" : "Show password")');
    expect(source).toContain('.accessibilityValue(showPassword ? "Password visible" : "Password hidden")');
  });

  it("shows credential failures without broadcasting a session expiry", () => {
    expect(apiClient).toContain("perform(req, broadcastsSessionExpiry: false)");
    expect(apiClient).toContain("if broadcastsSessionExpiry {");
    expect(apiClient).toContain('?? "Invalid credentials"');
  });
});
