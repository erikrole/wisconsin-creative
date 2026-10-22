import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStatusLabel, deviceName, distinctWebClients, groupIosClients, versionLabel } from "@/app/(app)/settings/app-activity/format";

const source = readFileSync("src/app/(app)/settings/app-activity/page.tsx", "utf8");

describe("App activity page UI contract", () => {
  it("leads with versions and usage, then one row per person instead of a wide table", () => {
    expect(source).toContain('label="On the current build"');
    expect(source).toContain('aria-label="Daily active people"');
    expect(source).toContain('aria-label="iPhone versions"');
    expect(source).toContain('aria-label="Most used screens"');
    expect(source).toContain('aria-label="People"');
    expect(source).not.toContain("<Table");
    expect(source).not.toContain("Compare unavailable");
    expect(source).not.toContain("No iOS client");
  });

  it("names versions and devices the way people say them", () => {
    expect(versionLabel("1.3", "34")).toBe("1.3 (34)");
    expect(deviceName("iPhone18,3")).toBe("iPhone 17");
    expect(deviceName("iPhone99,9")).toBe("iPhone99,9");
    expect(buildStatusLabel("stale")).toBe("Behind");
    expect(buildStatusLabel("development")).toBe("Dev build");
  });

  it("folds Xcode and simulator builds into one chip and shows each real phone once", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 21, h)).toISOString();
    const client = (over: Record<string, unknown>) => ({
      appVersion: "1.2", appBuild: "32", deviceModel: "iPhone17,1", releaseChannel: "app_store",
      buildStatus: "latest" as const, lastSeenAt: at(1), dormant: false, ...over,
    });
    const { phones, testBuilds } = groupIosClients([
      client({}),
      client({ lastSeenAt: at(5) }),
      client({ appVersion: "1.3", appBuild: "33", releaseChannel: "development", buildStatus: "development" }),
      client({ appVersion: "1.3", appBuild: "34", deviceModel: "arm64", releaseChannel: "development", buildStatus: "development" }),
      client({ appVersion: "1.2", appBuild: "30", deviceModel: "arm64", releaseChannel: "testflight", buildStatus: "stale" }),
    ]);
    expect(phones).toHaveLength(1);
    expect(phones[0]!.lastSeenAt).toBe(at(5));
    expect(testBuilds.map((build) => build.appBuild)).toEqual(["34", "33", "30"]);
    expect(source).toContain("<TestBuildsChip");
  });

  it("names one browser on the web chip and counts the others, not every browser profile", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 21, h)).toISOString();
    expect(
      distinctWebClients([
        { deviceModel: "Chrome · Mac", lastSeenAt: at(1) },
        { deviceModel: "Chrome · Mac", lastSeenAt: at(2) },
        { deviceModel: "Safari · iPhone", lastSeenAt: at(3) },
      ]),
    ).toEqual(["Safari · iPhone", "Chrome · Mac"]);
    expect(source).not.toContain("browsers</span>");
  });
});
