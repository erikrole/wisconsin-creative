import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appEntries, renderAppsPage } from "@/lib/apps-page";

const html = renderAppsPage();
const routeSource = readFileSync("src/app/apps/route.ts", "utf8");
const pageSource = readFileSync("src/lib/apps-page.ts", "utf8");

describe("apps page", () => {
  it("opens without signing in and is not a static file", () => {
    expect(routeSource).not.toContain("requireAuth");
    expect(routeSource).not.toContain("loginPathWithReturnTo");
    expect(existsSync("public/apps/index.html")).toBe(false);
  });

  it("ships only nonced scripts and no inline handlers", () => {
    expect(renderAppsPage("abc")).not.toMatch(/<script(?![^>]*nonce=)/i);
    expect(renderAppsPage("abc")).toContain('<script nonce="abc">');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("uses Apple platform names and drops the public-tool claims", () => {
    expect(html).toContain("iPhone and iPad");
    expect(html).toContain("macOS");
    expect(html).not.toMatch(/iOS app|\bMac ·|iPhone and iPad ·? ?Invite/);
    expect(html).not.toMatch(/no sign-in|nothing leaves your browser/i);
    expect(html).toContain("Radio Clip");
  });

  it("shows sourced version, requirement, and download facts, and each icon file exists", () => {
    for (const app of appEntries) {
      expect(html).toContain(`/apps/icons/${app.icon}.png`);
      expect(existsSync(`public/apps/icons/${app.icon}.png`)).toBe(true);
      if (app.version) expect(html).toContain(`Version ${app.version}`);
    }
    expect(html).toContain("<span>Version 1.5.3</span><span>Requires macOS 15.0 or later</span>");
    expect(html).not.toContain("Developer ID");
    expect(html).not.toContain("Pro Video Formats");
    expect(html).toContain("https://github.com/erikrole/offload-releases/releases/download/v1.5.3/Offload-1.5.3.dmg");
    expect(html).not.toContain("release notes");
    expect(html).toContain("Sony FX6 and FX3");
    expect(html).toContain("<span>Version 1.3</span><span>Requires iOS 26.0 or later</span>");
    expect(html).not.toContain("wisconsin-creative-home");
    expect(html).not.toContain('class="shot"');
    expect(html).toContain("<span>Version 1.5.4</span><span>Requires macOS 27 or later</span>");
    expect(html).toContain("https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg");
    expect(html).not.toContain("Version 0.1.0");
    expect(html).not.toContain("Notarized");
    expect(html).toContain("Radio Clip");
    expect(html).toContain("Media Lab");
    expect(html).toContain("Coming Late 2026");
    expect(html).toContain("https://apps.apple.com/us/app/wisconsin-creative/id6763456945");
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('content="noindex"');
    expect(html).toContain("<h3>Offload</h3>");
    expect(pageSource).toContain("TODO(apps):");
  });
});
