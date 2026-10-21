import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStatusLabel, deviceName, versionLabel } from "@/app/(app)/settings/app-activity/format";

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
});
