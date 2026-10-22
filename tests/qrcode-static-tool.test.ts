import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createRequire } from "node:module";
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
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none';`,
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

  it("is stamped by the shared static-tool hash script", () => {
    expect(readFileSync("scripts/hash-static-tools.mjs", "utf8")).toContain('"public/qrcode/index.html"');
    expect(html).toContain("Canonical source: edit here.");
  });

  it("ends the top bar with the shared Wisconsin Creative badge", () => {
    expect(html).toMatch(/<div class="wc-brand">\s*<a class="wc-apps" href="\/apps">[\s\S]*?<span class="wc-badge" role="img" aria-label="Wisconsin Creative"><span class="wc-badge-w"><\/span><\/span>\s*<\/div>\s*<\/header>/);
    expect(html).toContain('mask: url("/brand/wc-badge.svg")');
    expect(existsSync("public/brand/wc-badge.svg")).toBe(true);
  });

  it("only calls a code scannable when every test size decodes", () => {
    const app = readFileSync(join(root, "app.js"), "utf8");
    expect(app).toContain("result.passed < sizes.length ? 'marginal'");
    expect(app).toContain("marginal: 'Scans unreliably'");
  });

  it("uses the shared self-hosted Lato files", () => {
    for (const file of ["Lato-Regular.woff2", "Lato-Bold.woff2", "Lato-Black.woff2"]) {
      expect(html).toContain(`url("/${file}")`);
      expect(existsSync(join("public", file)), file).toBe(true);
    }
  });
});

describe("QR Studio core rules", () => {
  const core = createRequire(import.meta.url)("../public/qrcode/core.js");

  it("encodes an event as a VEVENT in UTC with escaped text", () => {
    const result = core.buildPayload("event", {
      title: "Badgers vs. Iowa; homecoming", location: "Camp Randall, Madison", start: "2026-10-24T14:30", end: "2026-10-24T18:00", notes: "Gates 1\nGates 2",
    });
    expect(result.ok).toBe(true);
    const offsetHours = new Date(2026, 9, 24, 14, 30).getTimezoneOffset() / 60;
    const startHour = String(14 + offsetHours).padStart(2, "0");
    expect(result.value.split("\r\n")).toEqual([
      "BEGIN:VEVENT",
      "SUMMARY:Badgers vs. Iowa\\; homecoming",
      `DTSTART:20261024T${startHour}3000Z`,
      `DTEND:20261024T${String(18 + offsetHours).padStart(2, "0")}0000Z`,
      "LOCATION:Camp Randall\\, Madison",
      "DESCRIPTION:Gates 1\\nGates 2",
      "END:VEVENT",
    ]);
  });

  it("rejects impossible or backwards event times", () => {
    expect(core.buildPayload("event", { title: "x", start: "" }).field).toBe("start");
    expect(core.buildPayload("event", { title: "x", start: "2026-02-30T10:00" }).field).toBe("start");
    expect(core.buildPayload("event", { title: "x", start: "2026-10-24T14:30", end: "2026-10-24T14:30" }).field).toBe("end");
    expect(core.buildPayload("event", { title: "x", start: "2026-10-24T14:30" }).notes[0]).toMatch(/two hours/);
  });

  it("names a contact file after the organisation when there is no person", () => {
    expect(core.fileBase("", "contact", { firstName: "", lastName: "", org: "Wisconsin Athletics" })).toBe("qr-contact-wisconsin-athletics");
    expect(core.fileBase("", "event", { title: "Badgers vs. Iowa" })).toBe("qr-event-badgers-vs-iowa");
  });

  it("keeps captions to one short, plain line", () => {
    expect(core.normalizeDesign({ caption: "  Scan\nfor\u0000  tickets " }).design.caption).toBe("Scan for tickets");
    expect(core.normalizeDesign({ caption: "x".repeat(90) }).design.caption).toHaveLength(core.CAPTION_MAX);
    expect(core.normalizeDesign({}).design.caption).toBe("");
  });

  it("adds the caption below the untouched code in SVG exports, escaped", () => {
    const inner = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect/></svg>';
    const out = core.captionedSvg(inner, { background: "#FFFFFF", fill: "#A00000", caption: "Tickets <now> & more" }, 1000);
    expect(out).toContain('height="1143" viewBox="0 0 1000 1143"');
    expect(out).toContain('<svg x="0" y="0" xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect/></svg>');
    expect(out).toContain(">Tickets &lt;now&gt; &amp; more</text>");
    expect(out).not.toContain("<?xml");
    const clear = core.captionedSvg(inner, { background: "transparent", fill: "#171717", caption: "Hi" }, 1000);
    expect(clear).not.toContain('<rect width="1000" height="1143"');
  });

  it("leaves the caption out of the CLI command", () => {
    const design = core.normalizeDesign({ caption: "Scan me" }).design;
    expect(core.cliCommand("url", { url: "https://uwbadgers.com" }, design, {})).not.toContain("Scan me");
  });

  it("never asks the library for its round corner eyes, which decoders miss", () => {
    for (const style of Object.keys(core.STYLES)) {
      for (const eyeShape of Object.keys(core.EYE_SHAPES)) {
        const design = core.normalizeDesign({ style, eyeShape }).design;
        const options = core.qrOptions("https://uwbadgers.com", design, { size: 600, moduleCount: 25 });
        expect(options.cornersSquareOptions.type, `${style}/${eyeShape}`).toBe("square");
        expect(options.cornersDotOptions.type, `${style}/${eyeShape}`).toBe("square");
      }
    }
  });

  it("gives older saves the eye shape their module style used to draw", () => {
    expect(core.normalizeDesign({ style: "dots" }).design.eyeShape).toBe("rounded");
    expect(core.normalizeDesign({ style: "rounded" }).design.eyeShape).toBe("rounded");
    expect(core.normalizeDesign({ style: "square" }).design.eyeShape).toBe("square");
    expect(core.normalizeDesign({ style: "dots", eyeShape: "square" }).design.eyeShape).toBe("square");
    expect(core.normalizeDesign({ eyeShape: "__proto__" }).design.eyeShape).toBe("square");
  });
});
