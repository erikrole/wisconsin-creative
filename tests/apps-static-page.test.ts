import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appEntries, renderAppsPage } from "@/lib/apps-page";

const html = renderAppsPage();
const routeSource = readFileSync("src/app/apps/route.ts", "utf8");

describe("apps page", () => {
  it("is signed-in only and not a public static file", () => {
    expect(routeSource).toContain("requireAuth");
    expect(routeSource).toContain('process.env.NODE_ENV === "development"');
    expect(routeSource).toContain('loginPathWithReturnTo("/apps")');
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

  it("shows version and release date for released apps, and each icon file exists", () => {
    for (const app of appEntries) {
      expect(html).toContain(`/apps/icons/${app.icon}.png`);
      expect(existsSync(`public/apps/icons/${app.icon}.png`)).toBe(true);
      if (app.version) expect(html).toContain(`Version ${app.version}`);
    }
    expect(html).toContain("Version 1.1.2 · Requires macOS 15 or later");
    expect(html).toContain("https://github.com/erikrole/offload-releases/releases/latest/download/Offload.dmg");
    expect(html).toContain("Version 1.1.0 · Requires macOS 27 or later");
    expect(html).toContain("https://github.com/erikrole/fetch-releases/releases/latest/download/Fetch.dmg");
    expect(html).toContain("Version 0.1.0");
    expect(html).not.toContain("Oct 13, 2026");
    expect(html).toContain("Media Lab");
    expect(html).toContain("Coming Late 2026");
    expect(html).toContain("https://apps.apple.com/us/app/wisconsin-creative/id6763456945");
  });
});
