import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("dashboard first-run banner", () => {
  const page = source("src/app/(app)/page.tsx");

  // Zero stats arrive before the full payload; treating "no data yet" as empty
  // flashed the welcome banner at returning staff.
  it("waits for the full payload before showing the welcome banner", () => {
    expect(page).toContain("const isFirstRun = statsEmpty && dataEmpty;");
    expect(page).not.toContain("(data ? dataEmpty : true)");
  });
});

describe("iOS DashboardData decoding", () => {
  const models = source("ios/Wisconsin/Models/DashboardModels.swift");

  // Home does not read these web-only fields, so the server must be free to
  // drop them from `scope=ios-home` without breaking installed builds.
  it.each(["teamCheckouts", "teamReservations", "overdueItems", "upcomingEvents"])(
    "decodes %s tolerantly",
    (field) => {
      expect(models).toContain(`forKey: .${field})`);
      expect(models).not.toMatch(new RegExp(`try c\\.decode\\([^)]*forKey: \\.${field}\\)`));
    },
  );
});
