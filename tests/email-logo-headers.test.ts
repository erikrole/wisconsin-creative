import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("email logo hosting", () => {
  it("serves the logo from a path that opts out of the same-origin resource policy", () => {
    // Outlook and other webview mail clients load the logo cross-origin and drop
    // it as a broken image when the site-wide Cross-Origin-Resource-Policy applies.
    expect(existsSync("public/email/logo.png")).toBe(true);

    const config = readFileSync("next.config.ts", "utf8");
    const rule = config.slice(config.indexOf('source: "/email/:path*"'));
    expect(rule.slice(0, 300)).toContain('{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }');
    // The email rule must come after the site-wide rule so it wins for that key.
    expect(config.indexOf('source: "/email/:path*"')).toBeGreaterThan(config.indexOf('source: "/:path*"'));

    expect(readFileSync("src/lib/email-template.ts", "utf8")).toContain("/email/logo.png");
  });
});
