import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS push registration health contracts", () => {
  it("keeps server token registration separate from OS permission state", () => {
    const appState = source("ios/Wisconsin/Core/AppState.swift");
    const delegate = source("ios/Wisconsin/App/AppDelegate.swift");
    const settings = source("ios/Wisconsin/Views/NotificationSettingsView.swift");

    expect(appState).toContain("enum PushRegistrationState: Equatable");
    expect(appState).toContain("var pushRegistrationState: PushRegistrationState = .unknown");
    expect(delegate).toContain("try await APIClient.shared.registerDeviceToken(hex)");
    expect(delegate).toContain("sharedAppState?.pushRegistrationState = .registered");
    expect(delegate).toContain("sharedAppState?.pushRegistrationState = .failed");
    expect(settings).toContain("pushRegistrationRow");
    expect(settings).toContain("Push registration needs attention");
  });

  it("retries registration for every non-denied authorization state", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");
    const prompt = source("ios/Wisconsin/Views/PushPrePromptView.swift");

    expect(app).toContain("case .authorized, .provisional, .ephemeral:");
    expect(app).toContain("appState.requestRemoteNotificationRegistration()");
    expect(prompt).toContain("appState.requestRemoteNotificationRegistration()");
    expect(app).not.toContain("if settings.authorizationStatus == .authorized");
  });

  it("keeps the pre-permission primary action legible when Settings inherits a primary tint", () => {
    const prompt = source("ios/Wisconsin/Views/PushPrePromptView.swift");
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    expect(prompt).toContain('Text("Turn on notifications")');
    expect(prompt).toContain(".buttonStyle(.borderedProminent)");
    expect(prompt).toContain(".tint(Color.brandPrimary)");
    expect(prompt).toContain(".fixedSize(horizontal: false, vertical: true)");
    expect(prompt).toContain("ScrollView {");
    expect(prompt).toContain(".scrollBounceBehavior(.basedOnSize)");
    expect(profile).toContain(".presentationDetents([.fraction(0.62), .large])");

  });
});
