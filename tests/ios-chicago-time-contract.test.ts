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

  it("pins .formatted(...) to Central, which ignores the process default zone", () => {
    expect(read("ios/Wisconsin/Core/DateFormats.swift")).toContain(
      "pinned.timeZone = NotificationPrefsViewModel.appTimeZone",
    );
    expect(
      read("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift"),
    ).toContain('pinned.timeZone = TimeZone(identifier: "America/Chicago")');
  });

  it("installs the same default zone in the widget and Live Activity extension", () => {
    expect(read("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift")).toContain(
      'NSTimeZone.default = TimeZone(identifier: "America/Chicago")',
    );
  });

  it("does not show Next Up as empty when its requests failed", () => {
    const profile = read("ios/Wisconsin/Views/ProfileView.swift");
    expect(profile).toContain("nextUpLoadFailed");
    expect(profile).toContain("Couldn't load what's coming up");
  });

  it("only makes the gear pick row a button when there is something to do", () => {
    const picks = read("ios/Wisconsin/Views/GearPicksView.swift");
    // Photo thumbnails keep their own tap; the row itself must not.
    expect(picks).not.toMatch(/\.onTapGesture \{\s*\/\/ A missing size/);
    expect(picks).toContain("Opens your profile to add your size");
  });
});
