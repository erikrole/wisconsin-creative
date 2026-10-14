import { describe, expect, it } from "vitest";
import { madisonDate, parseAppStore, parseGithubRelease } from "@/lib/apps-live-versions";
import { renderAppsPage } from "@/lib/apps-page";

describe("apps live versions", () => {
  it("reads the App Store version and dates it in Madison time", () => {
    const body = { results: [{ version: "1.4", currentVersionReleaseDate: "2026-10-14T02:30:00Z" }] };
    expect(parseAppStore(body)).toEqual({ version: "1.4", released: "2026-10-13" });
  });

  it("reads a GitHub release tag without the leading v", () => {
    expect(parseGithubRelease({ tag_name: "v1.1.2" })).toEqual({ version: "1.1.2" });
  });

  it("ignores anything that is not a version", () => {
    expect(parseAppStore({ results: [] })).toBeUndefined();
    expect(parseAppStore({ results: [{ version: "<script>" }] })).toBeUndefined();
    expect(parseGithubRelease({ tag_name: "latest" })).toBeUndefined();
    expect(parseGithubRelease(null)).toBeUndefined();
    expect(madisonDate("nope")).toBeUndefined();
  });

  it("shows the live versions on the cards and falls back to the written ones", () => {
    expect(renderAppsPage("n", { offload: { version: "9.9.9" }, "wisconsin-creative": { version: "8.8", released: "2026-11-01" } })).toContain("Version 9.9.9");
    const html = renderAppsPage("n", { "wisconsin-creative": { version: "8.8", released: "2026-11-01" } });
    expect(html).toContain("Version 8.8 · Nov 1, 2026");
    expect(html).toContain("Version 1.1.2");
    expect(renderAppsPage("n")).toContain("Version 1.2 · Sep 14, 2026");
  });
});
