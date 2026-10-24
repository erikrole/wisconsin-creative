import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("iOS app time zone", () => {
  it("installs America/Chicago as the default zone at launch", () => {
    const app = read("ios/Wisconsin/App/WisconsinApp.swift");
    expect(app).toContain("NSTimeZone.default = NotificationPrefsViewModel.appTimeZone");
    expect(read("ios/Wisconsin/Core/Preferences.swift")).toContain(
      'TimeZone(identifier: "America/Chicago")',
    );
  });

  it("does not show Next Up as empty when its requests failed", () => {
    const profile = read("ios/Wisconsin/Views/ProfileView.swift");
    expect(profile).toContain("nextUpLoadFailed");
    expect(profile).toContain("Couldn't load what's coming up");
  });

  it("only makes the gear pick row a button when there is something to do", () => {
    const picks = read("ios/Wisconsin/Views/GearPicksView.swift");
    expect(picks).not.toContain("onTapGesture");
    expect(picks).toContain("Opens your profile to add your size");
  });
});
