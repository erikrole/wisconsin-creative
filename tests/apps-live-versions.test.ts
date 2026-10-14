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

  it("reads the App Store minimum iOS version", () => {
    expect(parseAppStore({ results: [{ version: "1.2", minimumOsVersion: "26.0" }] })).toEqual({
      version: "1.2",
      requires: "iOS 26.0 or later",
    });
  });

  it("reads the Offload asset, date, and macOS line from a GitHub release", () => {
    expect(
      parseGithubRelease({
        tag_name: "v1.2.0",
        published_at: "2026-10-14T03:27:05Z",
        html_url: "https://github.com/erikrole/offload-releases/releases/tag/v1.2.0",
        body: "Runs on macOS 15 and later.",
        assets: [
          {
            name: "Offload-1.2.0.dmg",
            browser_download_url: "https://github.com/erikrole/offload-releases/releases/download/v1.2.0/Offload-1.2.0.dmg",
          },
          {
            name: "notes.txt",
            browser_download_url: "https://example.com/notes.txt",
          },
        ],
      }),
    ).toEqual({
      version: "1.2.0",
      released: "2026-10-13",
      href: "https://github.com/erikrole/offload-releases/releases/download/v1.2.0/Offload-1.2.0.dmg",
      releaseHref: "https://github.com/erikrole/offload-releases/releases/tag/v1.2.0",
      requires: "macOS 15 or later",
    });
  });

  it("drops a download URL that is not the Offload release asset", () => {
    expect(parseGithubRelease({ tag_name: "v1.2.0", html_url: "javascript:alert(1)", assets: [{ name: "Offload-1.2.0.dmg", browser_download_url: "https://evil.example/Offload.dmg" }] })).toEqual({
      version: "1.2.0",
    });
  });

  it("ignores anything that is not a version", () => {
    expect(parseAppStore({ results: [] })).toBeUndefined();
    expect(parseAppStore({ results: [{ version: "<script>" }] })).toBeUndefined();
    expect(parseGithubRelease({ tag_name: "latest" })).toBeUndefined();
    expect(parseGithubRelease(null)).toBeUndefined();
    expect(madisonDate("nope")).toBeUndefined();
  });

  it("shows the live versions on the cards and falls back to the written ones", () => {
    const moved = renderAppsPage("n", { offload: { version: "9.9.9" }, "wisconsin-creative": { version: "8.8", released: "2026-11-01" } });
    expect(moved).toContain("Version 9.9.9");
    expect(moved).not.toContain("Developer ID signed");
    expect(moved).not.toContain("Offload-1.2.0.dmg");
    expect(moved).not.toContain("macOS 15.0");
    const html = renderAppsPage("n", { "wisconsin-creative": { version: "8.8", released: "2026-11-01", requires: "iOS 27.0 or later" } });
    expect(html).toContain("<span>Version 8.8 · Nov 1, 2026</span><span>Requires iOS 27.0 or later</span>");
    expect(html).toContain("<span>Version 1.2.0 · Oct 13, 2026</span><span>Requires macOS 15.0 or later</span>");
    expect(renderAppsPage("n")).toContain("<span>Version 1.2 · Sep 14, 2026</span><span>Requires iOS 26.0 or later</span>");
    const fetchLive = renderAppsPage("n", { fetch: { version: "2.0.0" } });
    expect(fetchLive).toContain("Version 2.0.0");
    expect(fetchLive).not.toContain("Requires macOS 27 or later");
  });
});
