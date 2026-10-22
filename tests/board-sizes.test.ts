import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations
import { checkGuides, readGuides, renderAll, renderDataJs, stampPage, validateManifest, validateSchema } from "../scripts/build-board-sizes.mjs";

function loadData(): Record<string, unknown> {
  const context: { window: Record<string, unknown> } = { window: {} };
  runInNewContext(readFileSync("public/board-sizes/data.js", "utf8"), context);
  return context.window.BOARD_DATA as Record<string, unknown>;
}

const manifest = JSON.parse(readFileSync("public/board-sizes/boards.json", "utf8"));
const schema = JSON.parse(readFileSync("public/board-sizes/boards.schema.json", "utf8"));
const nextConfigSource = readFileSync("next.config.ts", "utf8");
const html = readFileSync("public/board-sizes/index.html", "utf8");
const app = readFileSync("public/board-sizes/app.js", "utf8");

describe("Board Sizes routing and page contract", () => {
  it("redirects the clean URLs onto dotted files the nonce middleware skips", () => {
    expect(nextConfigSource).toContain('{ source: "/board-sizes", destination: "/board-sizes/index.html", permanent: false }');
    expect(nextConfigSource).toContain('{ source: "/tools", destination: "/apps", permanent: false }');
    expect(readFileSync("src/middleware.ts", "utf8")).toContain(".*\\\\..*");
  });

  it("ships a strict CSP with no inline script or handlers", () => {
    for (const file of [html, readFileSync("public/tools/index.html", "utf8")]) {
      expect(file).toMatch(/default-src 'none'/);
      expect(file).toMatch(/connect-src 'none'|style-src 'unsafe-inline'/);
      expect(file).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
      expect(file).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it("stamps script URLs with the current file hash", () => {
    expect(stampPage("public/board-sizes/index.html")).toBe(html);
    const sources = [...html.matchAll(/<script src="([^"?]+)\?v=([0-9a-f]{12})"><\/script>/g)];
    expect(sources.map(([, file]) => file)).toEqual(["data.js", "app.js"]);
    for (const [, file = "", query] of sources) {
      const hash = createHash("sha256").update(readFileSync(`public/board-sizes/${file}`)).digest("hex").slice(0, 12);
      expect(query, file).toBe(hash);
    }
  });

  it("keeps the folder to the manifest, generated files, and the page", () => {
    expect(readdirSync("public/board-sizes").sort()).toEqual([
      "app.js", "boards.csv", "boards.json", "boards.schema.json", "data.js", "design", "index.html", "index.json", "llms.txt",
    ]);
    expect(readdirSync("public/board-sizes/design").sort()).toEqual(manifest.venues.map((v: { id: string }) => `${v.id}.md`).sort());
  });

  it("makes copy-the-spec the primary action and keeps guides at exact pixels", () => {
    expect(app).toContain("Copy spec");
    expect(app).toContain("safe area: none recorded");
    expect(app).toContain("image/svg+xml");
    expect(app).toContain("width=\"' + w + '\" height=\"' + h + '\"");
    expect(app).toMatch(/share(:| =) params\.get\('share'\) === '1'/);
    expect(app).toMatch(/if \(state\.share\) \{[^}]*apps\.hidden = true;/);
    expect(app).toContain("if (DATA.links && DATA.links.aeTemplate)");
    expect(html).toContain('href="#content"');
    expect(html).toContain('id="content"');
  });
});

describe("Board Sizes wc-fresh shell and hardening", () => {
  it("self-hosts Lato from the shared static-tool font files and keeps the Badger red accent", () => {
    for (const weight of ["Regular", "Bold", "Black"]) {
      expect(html).toContain(`url("/Lato-${weight}.woff2")`);
      expect(readdirSync("public")).toContain(`Lato-${weight}.woff2`);
    }
    expect(html).not.toContain("Gotham");
    expect(html).toContain("--accent: #c5050c");
    expect(html).toMatch(/font-src 'self'/);
  });

  it("never lets a malformed #link throw", () => {
    expect(app).toContain("function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }");
    expect(app.replace(/function safeDecode[^\n]*/, "")).not.toContain("decodeURIComponent(");
  });

  it("falls back to a legacy copy when the async clipboard is missing or refused", () => {
    expect(app).toContain("navigator.clipboard.writeText(text).then(ok, fallback)");
    expect(app).toContain("document.execCommand('copy')");
  });

  it("makes the More menus keyboard operable", () => {
    const menu = app.slice(app.indexOf("function moreMenu"), app.indexOf("function shareItem"));
    expect(menu).toContain("role', 'menu'");
    expect(menu).toContain("'ArrowDown'");
    expect(menu).toMatch(/e\.key === 'Escape'[\s\S]*sum\.focus\(\)/);
    expect(html).toContain('aria-controls="top-links"');
  });
});

describe("Board Sizes art preview and board comps", () => {
  it("keeps previewed art on the device", () => {
    const preview = app.slice(app.indexOf("/* ---------------- art preview"), app.indexOf("function renderBoard"));
    expect(preview).toContain("URL.createObjectURL(file)");
    expect(preview).toContain("URL.revokeObjectURL");
    expect(preview).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/);
    expect(html).toMatch(/img-src data: blob:/);
    expect(html).toMatch(/connect-src 'none'/);
  });

  it("places art on the exact board, then the exact zone, then the same shape, else fits and flags it", () => {
    const place = app.slice(app.indexOf("function artPlacement"), app.indexOf("function artBar"));
    const order = ["Exact size for this board", "'Exact size for ' + where(exact)", "Same shape as the board", "'Same shape as ' + where(shape)", "Not a size on this board"];
    const at = order.map((t) => place.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("downloads an After Effects comps script for a whole board", () => {
    expect(app).toContain("aeScript({ name: v.name + ' ' + d.name, board: true }, rows)");
    expect(app).toContain("one for the whole board and one per distinct zone size");
  });
});

describe("Board Sizes review fixes", () => {
  it("keeps URL and search lookups off Object.prototype", () => {
    expect(app).toContain("function dict() { return Object.create(null); }");
    for (const name of ["venueById", "BY_ID", "KEYS", "KEY_ID", "CONTENT", "TERM"]) expect(app).toContain(`var ${name} = dict();`);
    expect(app).toContain("state.page = own(PAGES, params.get('p'))");
    expect(app).toContain("(own(SYNONYMS, w) ? SYNONYMS[w] : [])");
  });

  it("draws the requested view before following a #zone, so ?d=board#zone is never blank", () => {
    expect(app).toMatch(/render\(false\);\n  if \(initialHash && !state\.query && !state\.content && !state\.page\) goTo\(initialHash, false, false\);/);
  });

  it("matches art to zones with no recorded position", () => {
    expect(app).toContain("(no position on file, shown fit to the board)");
  });

  it("writes the AE script with a BOM and flags disputed frame rates", () => {
    expect(app).toContain("return '\\uFEFF' + [");
    expect(app).toContain("sources disagree, so this uses");
  });

  it("moves focus to the new view and closes the phone menu on focus out", () => {
    expect(app).toContain("el.title.focus({ preventScroll: true });");
    expect(app).toContain("el['top-links'].addEventListener('focusout'");
    expect(app).not.toContain("TERM.stills");
  });
});

describe("Board Sizes shared tool header", () => {
  it("uses the shared tool header: name top left, Apps top right", () => {
    expect(html).toMatch(/<header class="topbar">\s*<div class="topbar-in">\s*<span class="brand">[\s\S]*?<span class="brand-name">Board Sizes<\/span>\s*<\/span>[\s\S]*?<a class="wc-apps" href="\/apps">[\s\S]*?<\/a>\s*<\/div>\s*<nav class="venue-tabs"/);
    expect(html).not.toContain("wc-badge");
    expect(existsSync("public/brand/wc-badge.svg")).toBe(false);
  });
});

describe("Board Sizes for people new to the boards", () => {
  it("explains the board terms on their own page", () => {
    expect(app).toContain("var PAGES = { agents: 1, issues: 1, terms: 1 };");
    for (const term of ["'FG / BG'", "'GIP'", "'Speaker scrim'", "'Pad'"]) expect(app).toContain(term);
    for (const term of ["'Zone'", "'Aspect ratio'", "'Cropped'"]) expect(app).not.toContain(`[${term},`);
    expect(app).toContain("['terms', 'Board terms', null]");
  });

  it("maps venue words to the boards' own names, without consumer words like jumbotron", () => {
    expect(app).not.toContain("jumbotron");
    expect(app).toContain("ribbon: ['fascia', 'ring']");
  });

  it("hides ids and canvas keys until Technical details is on, and remembers the choice", () => {
    expect(app).toContain("var showTech = storageGet(TECH_KEY) === '1';");
    expect(app).toContain("document.body.classList.toggle('hide-tech', !showTech);");
    expect(html).toContain(".hide-tech .card-props");
  });

  it("starts the venue page with what you're making", () => {
    expect(app).toContain("head.appendChild(node('h2', '', 'What are you making?'));");
    expect(app).toMatch(/if \(!match && state\.venueFilter !== 'issues'\) \{ var start = renderStart\(v\);/);
  });
});

describe("Board manifest", () => {
  it("matches the schema and every generated file is fresh", () => {
    expect(validateSchema(manifest, schema)).toEqual([]);
    expect(validateManifest(manifest)).toEqual([]);
    expect(readFileSync("public/board-sizes/data.js", "utf8")).toBe(renderDataJs(manifest));
    const outputs: Record<string, string> = renderAll(readFileSync("public/board-sizes/boards.json", "utf8"));
    for (const [path, text] of Object.entries(outputs)) {
      expect(readFileSync(path, "utf8") === text, `${path} is stale: run node scripts/build-board-sizes.mjs`).toBe(true);
    }
  });

  it("fails the schema check when a board grows an unknown field", () => {
    const extra = structuredClone(manifest);
    extra.venues[0].displays[0].invented = 1;
    expect(validateSchema(extra, schema).join("\n")).toMatch(/unexpected property invented/);
  });

  it("logs every version in changes", () => {
    expect(manifest.changes[0].version).toBe(manifest.version);
    const drifted = structuredClone(manifest);
    drifted.version = "2099-01-01.1";
    expect(validateManifest(drifted).join("\n")).toMatch(/changes must start with an entry for 2099-01-01.1/);
  });

  it("gives every display and zone a unique, stable id", () => {
    type Z = { id: string };
    const ids = manifest.venues.flatMap((v: { displays: { id: string; zones: Z[] }[] }) => v.displays.flatMap((d) => [d.id, ...d.zones.map((z) => z.id)]));
    expect(ids).toHaveLength(223);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["camp-randall/north-board", "camp-randall/north-board/main-video-fg", "kohl-center/360-fascia", "field-house/table/left-gip-bg-8", "goodman/main"]) expect(ids).toContain(id);
  });

  it("rejects a position outside its display and an unknown issue kind", () => {
    const bad = structuredClone(manifest);
    bad.venues[0].displays[0].zones[3].at = [{ x: 5000, y: 0 }];
    bad.venues[1].displays[0].issues[0].kind = "maybe";
    const problems = validateManifest(bad).join("\n");
    expect(problems).toMatch(/Main Video-FG: at x 5000, y 0 falls outside the display/);
    expect(problems).toMatch(/unknown issue kind maybe/);
  });

  it("keeps the stable canvas keys production tools build against", () => {
    const keys = manifest.canvases.map((c: { key: string }) => c.key);
    expect(keys).toHaveLength(58);
    for (const key of ["MAIN_FULL", "MAIN_HD", "FASCIA_FULL", "KC_MAIN", "KC_FASCIA", "FH_MAIN", "LB_MAIN"]) expect(keys).toContain(key);
    const by = (key: string) => manifest.canvases.find((c: { key: string }) => c.key === key);
    expect(by("FASCIA_FULL")).toMatchObject({ w: 11880, h: 108, fps: 60 });
    expect(by("KC_MAIN")).toMatchObject({ w: 1104, h: 624 });
    expect(by("IPTV_FULL_SCREEN")).toMatchObject({ w: 1920, h: 1080, safeInset: 100 });
  });

  it("catches a canvas that drifts from its board", () => {
    const drifted = structuredClone(manifest);
    drifted.canvases.find((c: { key: string }) => c.key === "KC_MAIN").h = 621;
    expect(validateManifest(drifted).join("\n")).toMatch(/KC_MAIN: 1104x621 but Centerhung Main is 1104x624/);
  });
});

describe("Board Sizes data", () => {
  const data = loadData();
  type Issue = { kind: string; field?: string; text: string };
  type Zone = { id: string; n: number; name: string; w: number; h: number; at?: { x: number; y: number }[]; atFrom?: string; pad?: number; issues?: Issue[] };
  type Display = { id: string; name: string; processor?: string; w: number; h: number; zones: Zone[]; sources: Record<string, string>; notes?: string[]; issues?: Issue[] };
  type Venue = { id: string; name: string; displays: Display[] };
  const venues = data.venues as Venue[];
  const display = (venue: string, name: string) => venues.find((v) => v.name === venue)!.displays.find((d) => d.name === name)!;

  it("covers every venue across the four sources", () => {
    expect(venues.map((v) => v.name)).toEqual(["Camp Randall", "Kohl Center", "Field House", "LaBahn Arena", "Goodman Diamond"]);
    expect(Object.keys(data.sources as object)).toEqual(["sheet", "guide", "colosseum", "builder"]);
    expect(venues.map((v) => v.displays.reduce((n, d) => n + d.zones.length, 0))).toEqual([81, 91, 24, 0, 0]);
  });

  it("places every zone inside its display", () => {
    for (const v of venues) {
      for (const d of v.displays) {
        expect(Object.keys(d.sources).length, d.name).toBeGreaterThan(0);
        for (const z of d.zones) {
          expect(z.w <= d.w && z.h <= d.h, `${d.name} / ${z.name}`).toBe(true);
          for (const { x, y } of z.at ?? []) {
            expect(["sheet", "guide", "builder", "derived"]).toContain(z.atFrom);
            expect(y >= 0 && x >= 0 && y + z.h <= d.h && x + z.w <= d.w, `${d.name} / ${z.name} at ${x},${y}`).toBe(true);
          }
        }
      }
    }
  });

  it("matches the Board Builder's North Board geometry and the recorded safe areas", () => {
    const north = display("Camp Randall", "North Board");
    const at = (name: string) => north.zones.find((z) => z.name === name)!;
    expect(at("Main Video-FG").at![0]).toEqual({ x: 1332, y: 0 });
    expect(at("GIP")).toMatchObject({ w: 3096, h: 140, at: [{ x: 1332, y: 1300 }] });
    expect(at("GIP").issues).toBeUndefined();
    expect(at("Wing-Left-FG").pad).toBe(20);
    expect(at("Main Video-FG").pad).toBeUndefined();
    const feed = display("Camp Randall", "North Board HD feed");
    expect(feed.zones[0]).toMatchObject({ w: 1920, h: 806, at: [{ x: 0, y: 94 }] });
    expect(display("Goodman Diamond", "Main")).toMatchObject({ w: 560, h: 308 });
    expect(display("LaBahn Arena", "Main")).toMatchObject({ w: 448, h: 256 });
  });

  it("keeps the sources' open questions instead of resolving them", () => {
    expect(display("Kohl Center", "360 Fascia").issues).toEqual([expect.objectContaining({ kind: "conflict", field: "fps" })]);
    expect(display("Kohl Center", "Main 16:9 feed").issues!.map((i) => i.kind)).toEqual(["unconfirmed", "conflict"]);
    expect(display("Field House", "Table").issues!.map((i) => i.text).join(" ")).toMatch(/Left GIP-BG/);
    expect(display("Goodman Diamond", "Main").issues!.map((i) => i.kind)).toEqual(["unconfirmed"]);
  });
});

describe("Board Sizes agent files", () => {
  const index = JSON.parse(readFileSync("public/board-sizes/index.json", "utf8"));
  type Board = { id: string; type: string; w: number; h: number; aspect: string; pad: number | null; safeInset: number | null; fps: number | null; canvasKeys: string[]; issues: { kind: string }[]; url: string };
  const board = (id: string): Board => index.boards.find((b: Board) => b.id === id);

  it("flattens every display and zone, including recorded safe insets only", () => {
    expect(index).toMatchObject({ schema: "wisconsin-board-sizes-index/1", version: manifest.version });
    expect(index.boards).toHaveLength(223);
    expect(board("camp-randall/north-board/main-video-fg")).toMatchObject({ w: 3096, h: 1440, aspect: "2.15:1", fps: 60, pad: null, safeInset: null, canvasKeys: ["MAIN_VIDEO"] });
    expect(board("camp-randall/north-board/wing-left-fg")).toMatchObject({ pad: 20, safeInset: null });
    expect(board("camp-randall/iptv-full-screen-ad")).toMatchObject({ safeInset: 100, w: 1920, h: 1080 });
    expect(board("goodman/main").safeInset).toBeNull();
    expect(board("kohl-center/centerhung-main")).toMatchObject({ w: 1104, h: 624, fps: 59.94 });
    const csv = readFileSync("public/board-sizes/boards.csv", "utf8").split("\n");
    expect(csv[0]).toContain("safe inset");
    expect(csv).toHaveLength(index.boards.length + 2);
  });

  it("tells agents the rules and does not invent a safe area", () => {
    const llms = readFileSync("public/board-sizes/llms.txt", "utf8");
    expect(llms).toContain(`Manifest ${manifest.version}`);
    expect(llms).toContain("Never hardcode or guess a board size");
    expect(llms).toContain("safe area: none recorded");
    expect(llms).toContain("100 px title safe");
    expect(llms).toContain("`goodman/main` (unconfirmed)");
    expect(checkGuides(manifest, readGuides(manifest))).toEqual([]);
  });
});
