import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const login = readFileSync(
  path.join(process.cwd(), "ios/Wisconsin/Views/LoginView.swift"),
  "utf8",
);

function section(start: string, end: string) {
  return login.slice(login.indexOf(start), login.indexOf(end));
}

describe("iOS Login presentation", () => {
  it("keeps password sign-in labeled while the request is active", () => {
    expect(login).toContain('passwordLoading ? "Signing in…" : "Sign in"');
    expect(login).toContain("Text(primaryButtonTitle)");
    expect(login).toMatch(
      /if discoveryLoading \|\| passwordLoading \{\s+ProgressView\(\)\s+\.controlSize\(\.small\)\s+\.accessibilityHidden\(true\)/,
    );
    expect(login).toContain(".buttonStyle(.glassProminent)");
    expect(login).toContain(".controlSize(.large)");
  });

  it("discovers the invited identity before choosing onboarding or password", () => {
    expect(login).toContain("@State private var loginStep: LoginStep = .identity");
    expect(login).toContain("private var identityStep: some View");
    expect(login).toContain("private var passwordStep: some View");
    expect(login).toContain("private func advanceToPassword()");
    expect(login).toContain("activeAuthMethod = .discovery");
    expect(login).toContain("APIClient.shared.discoverAuth(email: submittedEmail)");
    expect(login).toContain("authDestination = .register(email: submittedEmail)");
    expect(login).toContain("setLoginStep(.password)");
    expect(login).toContain("setLoginStep(.identity)");
    expect(login).toContain('Text("Email address")');
    expect(login).toContain('Text("Password")');
    expect(login).not.toContain("credentialGroupFill");

    const discoveryAdvance = section("private func advanceToPassword()", "private func changeEmail()");
    expect(discoveryAdvance).not.toContain("session.login");
    expect(discoveryAdvance).toContain("APIClient.shared.discoverAuth");
    expect(login).toContain("if reduceMotion");
    expect(login).toContain("@AccessibilityFocusState private var accessibilityFocused: Field?");
    expect(login).toContain('step == .identity ? "Enter your email address" : "Enter your password"');
  });

  it("keeps recovery quiet under Password and supports changing identity", () => {
    const passwordStep = section("private var passwordStep: some View", "private func fieldFill");

    expect(passwordStep).toContain('Text("Signing in as")');
    expect(passwordStep).toContain('TextField("Account", text: .constant(trimmedEmail))');
    expect(passwordStep).toContain(".textContentType(.username)");
    expect(passwordStep).toContain('Button("Change")');
    expect(passwordStep).toContain('Button("Forgot password?")');
    expect(passwordStep.indexOf('Button("Forgot password?")')).toBeGreaterThan(
      passwordStep.indexOf('Text("Password")'),
    );
    expect(login).toContain('password = ""');
    expect(login).toContain("focused = step == .identity ? .email : .password");
    expect(passwordStep).toContain(".accessibilityFocused($accessibilityFocused, equals: .password)");
    expect(passwordStep).toContain("authDestination = .forgotPassword(email: trimmedEmail)");
  });

  it("keeps passkey identity-independent on the email step", () => {
    const card = section("private var card: some View", "private var identityStep: some View");
    const passkey = card.slice(card.indexOf("if loginStep == .identity {", card.indexOf("if loginStep == .identity {") + 1));

    expect(passkey).toContain('Text(passkeyLoading ? "Waiting for passkey…" : "Use a passkey")');
    expect(passkey).toContain('.accessibilityHint("Choose an account with a saved passkey")');
    expect(passkey).toContain("submitPasskey()");
    expect(passkey).toContain(".buttonStyle(.glass)");
    expect(passkey).toContain(".tint(.primary)");
    expect(passkey).toContain(".disabled(authBusy)");
    expect(section("private var passwordStep: some View", "private func fieldFill")).not.toContain("submitPasskey()");
  });

  it("prevents password, passkey, and recovery actions from racing", () => {
    expect(login).toMatch(
      /private var authBusy: Bool \{\s+activeAuthMethod != nil \|\| session\.isLoading\s+\}/,
    );
    expect(login).toContain("activeAuthMethod = .password");
    expect(login).toContain("activeAuthMethod = .discovery");
    expect(login).toContain("activeAuthMethod = .passkey");
    expect(login).toContain("!trimmedEmail.isEmpty && !password.isEmpty && !authBusy");
    expect(section('Button("Change")', 'Text("Password")')).toContain(".disabled(authBusy)");
    expect(section('Button("Forgot password?")', "private func fieldFill")).toContain(".disabled(authBusy)");
    expect(section("if loginStep == .identity {", "private var identityStep: some View")).toContain(".disabled(authBusy)");
  });

  it("renders failures as one semantic inline message", () => {
    expect(login).toContain('Label(error, systemImage: "exclamationmark.circle.fill")');
    expect(login).toContain(".foregroundStyle(Color.statusText(.red))");
    expect(login).toContain(".background(Color.statusBackground(.red)");
    expect(login).toContain('.accessibilityLabel("Sign in failed. \\(error)")');
    expect(login).toContain("AccessibilityNotification.Announcement(error).post()");
  });

  it("retains native auth recovery and 44-point utility controls", () => {
    expect(login).toContain('Button("Forgot password?")');
    expect(login).toContain("Enter your invited email to get started.");
    expect(login).not.toContain('Button("Need an account?")');
    expect(section('Button("Change")', 'Text("Password")')).toContain(".frame(minWidth: 44, minHeight: 44)");
    expect(section('Button("Forgot password?")', "private func fieldFill")).toContain(".frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)");
    expect(section("Button {\n                    showPassword.toggle()", 'Button("Forgot password?")')).toContain(".frame(width: 44, height: 44)");
    expect(login).toContain("NativeForgotPasswordView(initialEmail: email)");
    expect(login).toContain("NativeRegistrationView(initialEmail: email)");
  });

  it("preserves normalized password auth and Keychain content types", () => {
    const submit = section("private func submit()", "private func submitPasskey()");
    const identity = section("private var identityStep: some View", "private var passwordStep: some View");
    const password = section("private var passwordStep: some View", "private func fieldFill");

    expect(submit).toContain("session.login(email: trimmedEmail, password: password)");
    expect(identity).toContain(".textContentType(.username)");
    expect(password).toContain(".textContentType(.password)");
    expect(section("private func changeEmail()", "private func setLoginStep")).toContain('password = ""');
  });
});
