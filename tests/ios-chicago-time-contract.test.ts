import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return swiftFiles(path);
    return name.endsWith(".swift") && !/Harness|Fixtures/.test(name) ? [path] : [];
  });
}

describe("iOS app time zone", () => {
  it("installs America/Chicago as the default zone at launch", () => {
    const app = read("ios/Wisconsin/App/WisconsinApp.swift");
    expect(app).toContain("NSTimeZone.default = NotificationPrefsViewModel.appTimeZone");
    expect(read("ios/Wisconsin/Core/Preferences.swift")).toContain(
      'TimeZone(identifier: "America/Chicago")',
    );
  });

  it("hands SwiftUI the app zone through the environment at the root", () => {
    // DatePicker edits in the environment zone, so a return time picked on a
    // phone set to Pacific was two hours off every Central label around it.
    const app = read("ios/Wisconsin/App/WisconsinApp.swift");
    expect(app).toContain(".environment(\\.timeZone, NotificationPrefsViewModel.appTimeZone)");
    expect(app).toContain(".environment(\\.calendar, NotificationPrefsViewModel.appCalendar)");
    expect(read("ios/Wisconsin/Kiosk/KioskDateFormatting.swift")).toContain(
      ".environment(\\.timeZone, KioskTime.timeZone)",
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

  it("never hands SwiftUI a date format that reads the device zone", () => {
    // `Text(date, format:)`, `\(date, format:)` in a Text interpolation,
    // `Text(date, style: .time)` and `AxisValueLabel(format:)` take a
    // FormatStyle directly, so the `formatted` overloads never see them and
    // they print in the phone's zone. A phone set to Pacific showed Pacific
    // due times on the Live Activity and the day before on report charts.
    const offenders = [
      ...swiftFiles("ios/Wisconsin"),
      ...swiftFiles("ios/WisconsinLiveActivities"),
    ].flatMap((file) => {
      const text = read(file);
      const hits = text.match(/(format: \.dateTime\b|style: \.(time|date)\b)/g) ?? [];
      return hits.length > 0 ? [`${file}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("builds pinned styles for Text(date, format:) in each process", () => {
    // The app, the widget extension and the kiosk each compile their own
    // copy; none of them shares DateFormats.swift with the others.
    expect(read("ios/Wisconsin/Core/DateFormats.swift")).toMatch(
      /static var chicago: Date\.FormatStyle[\s\S]*?style\.timeZone = NotificationPrefsViewModel\.appTimeZone/,
    );
    expect(read("ios/Wisconsin/Core/DateFormats.swift")).toMatch(
      /static var utcDay: Date\.FormatStyle[\s\S]*?style\.timeZone = \.gmt/,
    );
    expect(read("ios/WisconsinLiveActivities/CheckoutReturnLiveActivityWidget.swift")).toMatch(
      /static var chicago: Date\.FormatStyle[\s\S]*?TimeZone\(identifier: "America\/Chicago"\)/,
    );
    expect(read("ios/Wisconsin/Kiosk/KioskDateFormatting.swift")).toMatch(
      /static var chicago: Date\.FormatStyle[\s\S]*?style\.timeZone = KioskTime\.timeZone/,
    );
  });

  it("labels report trend days in GMT, the zone they were bucketed in", () => {
    // `ReportTrendPoint.parseDay` builds each day at UTC midnight. Formatting
    // that in Central reads as 7 PM the evening before, so every axis label
    // and callout was one day early.
    for (const file of ["ios/Wisconsin/Views/ReportsView.swift", "ios/Wisconsin/Views/Reports/CheckoutReportView.swift"]) {
      const text = read(file);
      expect(text).toContain("AxisValueLabel(format: .utcDay.month(.abbreviated).day())");
      expect(text).toMatch(/match\.day(\.formatted\(|, format: )\.utcDay\./);
    }
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
