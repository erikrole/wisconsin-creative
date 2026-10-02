import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * Relative-day labels ("Today", "Tomorrow", due-today tones) must depend on
 * the `\.today` environment value, not the wall clock. `isDateInToday` and
 * friends read the clock, but SwiftUI never re-runs a body whose inputs did
 * not change, so an app left open overnight kept Thursday's "Tomorrow" on
 * Friday's events. `CurrentDay.swift` documents the pattern.
 */
function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return swiftFiles(full);
    return name.endsWith(".swift") ? [full] : [];
  });
}

function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("iOS current-day rollover", () => {
  it("never reads the wall clock for relative-day checks", () => {
    const offenders = swiftFiles(path.join(process.cwd(), "ios/Wisconsin"))
      .filter((file) => /\.isDateIn(Today|Tomorrow|Yesterday)\(/.test(stripComments(source(file))))
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("provides the current day at both iOS app roots", () => {
    expect(source("ios/Wisconsin/App/WisconsinApp.swift")).toContain(".providesCurrentDay()");
    expect(source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift")).toContain(".providesCurrentDay()");
  });

  it("refreshes on midnight, clock changes, and foregrounding", () => {
    const provider = source("ios/Wisconsin/Shared/CurrentDay.swift");
    expect(provider).toContain(".NSCalendarDayChanged");
    expect(provider).toContain("significantTimeChangeNotification");
    expect(provider).toContain("phase == .active");
  });

  it("keys the Schedule day header to the environment day", () => {
    const row = source("ios/Wisconsin/Views/Schedule/ScheduleEventRow.swift");
    const header = row.slice(row.indexOf("struct ScheduleDateHeader"));
    expect(header).toContain("@Environment(\\.today)");
    expect(header).toContain("dayOffset(of: date, from: today) == 1");
  });
});
