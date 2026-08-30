import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS notification delivery truth", () => {
  it("distinguishes account pause, OS permission, APNs registration, and self-test delivery", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");

    expect(detail).toContain("if prefsVM.isPaused");
    expect(detail).toContain("prefsVM.pausedUntilDate");
    expect(detail).toContain("Paused until");
    expect(detail).toContain("Push is on, but iOS notifications are off.");
    expect(detail).toContain("Push is on, but this device needs registration attention.");
    expect(detail).toContain("private var deviceRegistrationReady");
    expect(detail).toContain("private var canSendTestPush");
    expect(detail).toContain("prefs.channels.push && !prefsVM.isPaused && pushAllowed && deviceRegistrationReady");
    expect(detail).toContain("guard canSendTestPush else");
    expect(detail).toContain("Register this device for push before sending a test notification.");
  });

  it("keeps loaded preference failures visible and announces the recovery message", () => {
    const detail = source("ios/Wisconsin/Views/NotificationSettingsView.swift");
    const preferences = source("ios/Wisconsin/Core/Preferences.swift");

    expect(detail).toContain("} else if let err = prefsVM.error {");
    expect(detail).toContain("preferenceErrorRow(");
    expect(detail).toContain("buttonTitle: prefsVM.prefs == nil ? \"Retry\" : \"Reload\"");
    expect(detail).toContain(".onChange(of: prefsVM.error)");
    expect(detail).toContain("AccessibilityNotification.Announcement(message).post()");
    expect(preferences).toContain("error = nil");
    expect(preferences).toContain("self.error = (error as? APIError)?.errorDescription ?? \"Couldn't save\"");
  });
});
