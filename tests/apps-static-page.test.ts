import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync("next.config.ts", "utf8");
const html = readFileSync("public/apps/index.html", "utf8");

describe("apps static page", () => {
  it("redirects /apps to its dotted file path so the nonce middleware skips it", () => {
    expect(nextConfigSource).toContain('{ source: "/apps", destination: "/apps/index.html", permanent: false }');
  });

  it("ships a strict CSP with no inline script or handlers", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("shows an icon for every app and each icon file exists", () => {
    for (const icon of ["wisconsin-creative", "offload", "radio"]) {
      expect(html).toContain(`/apps/icons/${icon}.png`);
      expect(existsSync(`public/apps/icons/${icon}.png`)).toBe(true);
    }
  });
});
