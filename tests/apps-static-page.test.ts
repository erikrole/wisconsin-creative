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

  it("ships no script or inline handlers", () => {
    expect(html).not.toMatch(/<script/i);
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
      if (!app.icon) continue;
      expect(html).toContain(`/apps/icons/${app.icon}.png`);
      expect(existsSync(`public/apps/icons/${app.icon}.png`)).toBe(true);
      if (app.version) expect(html).toContain(`Version ${app.version}`);
    }
    expect(html).toContain("Version 1.0.8");
    expect(html).not.toContain("Oct 13, 2026");
    expect(html).toContain("Media Lab");
    expect(html).toContain("Coming Late 2026");
    expect(html).toContain("https://apps.apple.com/us/app/wisconsin-creative/id6763456945");
  });
});
