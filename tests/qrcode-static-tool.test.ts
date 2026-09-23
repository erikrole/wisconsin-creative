import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "public/qrcode";
const html = readFileSync(join(root, "index.html"), "utf8");
const nextConfigSource = readFileSync("next.config.ts", "utf8");
const middlewareSource = readFileSync("src/middleware.ts", "utf8");
const serviceWorkerSource = readFileSync("public/sw.js", "utf8");

describe("QR Studio static tool at /qrcode", () => {
  it("redirects /qrcode to the dotted file path so the nonce middleware skips it", () => {
    expect(nextConfigSource).toContain('{ source: "/qrcode", destination: "/qrcode/index.html", permanent: false }');
    // The middleware matcher must keep excluding dotted paths, or its nonce CSP
    // would block the tool's same-origin scripts.
    expect(middlewareSource).toContain(".*\\\\..*");
  });

  it("ships its own strict CSP with no inline script", () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' file:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';`,
    );
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("loads only exported files, each with a matching content hash", () => {
    const sources = [...html.matchAll(/<script src="([^"?]+)\?v=([0-9a-f]{12})"><\/script>/g)];
    expect(sources.length).toBe([...html.matchAll(/<script /g)].length);
    // The service worker caches .js cache-first, so every URL must change with its content.
    expect(serviceWorkerSource).toMatch(/\\\.\(js\|/);
    for (const [, file = "", query] of sources) {
      expect(existsSync(join(root, file)), file).toBe(true);
      const hash = createHash("sha256").update(readFileSync(join(root, file))).digest("hex").slice(0, 12);
      expect(query, file).toBe(hash);
    }
  });

  it("contains nothing but the exported app", () => {
    const list = (dir: string, prefix = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? list(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
      );
    expect(list(root).sort()).toEqual([
      "app.js",
      "assets/brand-logos.js",
      "core.js",
      "index.html",
      "vendor/jsQR.js",
      "vendor/qr-code-styling.js",
    ]);
  });
});
