import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations
import { HASHED_TOOLS, stamp } from "../scripts/hash-static-tools.mjs";
// @ts-expect-error -- plain .mjs script without type declarations
import { renderAll, renderDataJs, validateManifest } from "../scripts/build-board-sizes.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadCore(path: string, name: string): any {
  const context: { window: Record<string, unknown> } = { window: {} };
  runInNewContext(readFileSync(path, "utf8"), context);
  return context.window[name];
}

const nextConfigSource = readFileSync("next.config.ts", "utf8");
const TOOLS = ["golden-hour", "timelapse", "board-sizes", "tools"] as const;

describe("static tools: routing, headers, and page contracts", () => {
  it("redirects each clean URL to its dotted file path so the nonce middleware skips it", () => {
    for (const tool of TOOLS) {
      expect(nextConfigSource).toContain(`{ source: "/${tool}", destination: "/${tool}/index.html", permanent: false }`);
    }
  });

  it("allows geolocation only under /golden-hour", () => {
    expect(nextConfigSource).toContain("const permissionsPolicy = permissionsPolicyFor(\"()\");");
    expect(nextConfigSource).toMatch(
      /source: "\/golden-hour\/:path\*",\s*headers: \[\{ key: "Permissions-Policy", value: permissionsPolicyFor\("\(self\)"\) \}\]/,
    );
    expect(nextConfigSource.match(/permissionsPolicyFor\("\(self\)"\)/g)).toHaveLength(1);
  });

  it.each(TOOLS)("%s ships a strict CSP with no inline script or handlers", (tool) => {
    const html = readFileSync(join("public", tool, "index.html"), "utf8");
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src 'none'|<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'/);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("stamps every script URL with its current content hash", () => {
    for (const path of HASHED_TOOLS as string[]) {
      expect(stamp(path), `${path} is stale: run node scripts/hash-static-tools.mjs`).toBe(readFileSync(path, "utf8"));
      expect(readFileSync(path, "utf8")).not.toContain("?v=000000000000");
    }
  });

  it("keeps each tool folder to its own files", () => {
    expect(readdirSync("public/golden-hour").sort()).toEqual(["app.js", "core.js", "index.html"]);
    expect(readdirSync("public/timelapse").sort()).toEqual(["app.js", "core.js", "index.html"]);
    expect(readdirSync("public/board-sizes").sort()).toEqual(
      ["app.js", "boards.csv", "boards.json", "boards.schema.json", "data.js", "index.html", "index.json", "llms.txt"],
    );
    expect(readdirSync("public/tools").sort()).toEqual(["index.html"]);
  });

  it("lists every public tool on the hub", () => {
    const hub = readFileSync("public/tools/index.html", "utf8");
    for (const href of ["/golden-hour", "/timelapse", "/board-sizes", "/qrcode"]) expect(hub).toContain(`href="${href}"`);
  });

  it("never writes a GPS fix into the shareable URL", () => {
    const app = readFileSync("public/golden-hour/app.js", "utf8");
    const share = app.slice(app.indexOf("function shareParams"), app.indexOf("function syncUrl"));
    expect(share).toContain("state.loc.kind === 'custom'");
    expect(share).not.toContain("'gps'");
  });
});

describe("Golden Hour core", () => {
  const gh = loadCore("public/golden-hour/core.js", "GoldenHourCore");
  const minutesIn = (date: Date, tz: string) => {
    const p = gh.zonedParts(date, tz);
    return p.h * 60 + p.mi;
  };
  const madison = gh.VENUES["camp-randall"];

  it("puts Madison sunrise and sunset where the almanac does (Sep 24, 2026)", () => {
    const t = gh.sunTimes({ y: 2026, m: 9, d: 24 }, madison.lat, madison.lon);
    // Independent almanac values for Madison: sunrise ≈ 6:48, sunset ≈ 6:52 CDT.
    expect(Math.abs(minutesIn(t.sunrise, madison.tz) - (6 * 60 + 48))).toBeLessThanOrEqual(3);
    expect(Math.abs(minutesIn(t.sunset, madison.tz) - (18 * 60 + 52))).toBeLessThanOrEqual(3);
  });

  it("orders the photographer-convention windows through the day", () => {
    const t = gh.sunTimes({ y: 2026, m: 9, d: 24 }, madison.lat, madison.lon);
    const order = ["blueStart", "goldStart", "sunrise", "goldEnd", "solarNoon", "goldEvStart", "sunset", "goldEvEnd", "blueEnd"];
    const times = order.map((key) => t[key].getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Golden hour straddles sunrise: −4° comes before −0.833°.
    expect(t.sunrise - t.goldStart).toBeGreaterThan(10 * 60000);
  });

  it("reports road venues in their own local time", () => {
    const ucla = gh.VENUES.ucla;
    const t = gh.sunTimes({ y: 2026, m: 9, d: 24 }, ucla.lat, ucla.lon);
    const sunset = minutesIn(t.sunset, ucla.tz);
    expect(sunset).toBeGreaterThan(18 * 60 + 40);
    expect(sunset).toBeLessThan(18 * 60 + 55);
    const noon = gh.sunTimes({ y: 2026, m: 9, d: 24 }, ucla.lat, ucla.lon).solarNoon;
    expect(gh.civilIn(noon, ucla.tz)).toEqual({ y: 2026, m: 9, d: 24 });
  });

  it("gives every venue a real time zone and a full set of sun events", () => {
    const ids = new Set<string>();
    for (const group of gh.VENUE_GROUPS) {
      for (const venue of group.venues) {
        expect(ids.has(venue.id)).toBe(false);
        ids.add(venue.id);
        expect(() => new Intl.DateTimeFormat("en-US", { timeZone: venue.tz })).not.toThrow();
        for (const day of [{ y: 2026, m: 6, d: 21 }, { y: 2026, m: 12, d: 21 }]) {
          const t = gh.sunTimes(day, venue.lat, venue.lon);
          for (const key of ["blueStart", "goldStart", "sunrise", "goldEnd", "goldEvStart", "sunset", "goldEvEnd", "blueEnd"]) {
            expect(t[key], `${venue.id} ${key}`).toBeTruthy();
            expect(gh.civilIn(t[key], venue.tz), `${venue.id} ${key} lands on its own day`).toEqual(day);
          }
        }
      }
    }
    expect(ids.size).toBe(21);
  });

  it("measures DST changeover days by the clock, not as 24 hours", () => {
    const span = (day: { y: number; m: number; d: number }) =>
      (gh.zonedInstant(gh.addDays(day, 1), 0, "America/Chicago") - gh.zonedInstant(day, 0, "America/Chicago")) / 3600000;
    expect(span({ y: 2026, m: 3, d: 8 })).toBe(23);
    expect(span({ y: 2026, m: 11, d: 1 })).toBe(25);
    expect(span({ y: 2026, m: 9, d: 24 })).toBe(24);
  });

  it("works out today per zone, not per device", () => {
    const instant = new Date("2026-09-25T03:30:00Z");
    expect(gh.civilIn(instant, "America/Chicago")).toEqual({ y: 2026, m: 9, d: 24 });
    expect(gh.civilIn(instant, "America/New_York")).toEqual({ y: 2026, m: 9, d: 24 });
    expect(gh.civilIn(new Date("2026-09-25T04:30:00Z"), "America/New_York")).toEqual({ y: 2026, m: 9, d: 25 });
  });

  it("rejects impossible dates from a shared link", () => {
    expect(gh.valueToDay("2026-02-30")).toBeNull();
    expect(gh.valueToDay("not-a-date")).toBeNull();
    expect(gh.valueToDay("2026-10-03")).toEqual({ y: 2026, m: 10, d: 3 });
  });

  it("classifies the light by sun altitude", () => {
    expect(gh.phaseFor(10).tone).toBe("day");
    expect(gh.phaseFor(0).tone).toBe("gold");
    expect(gh.phaseFor(-3.9).tone).toBe("gold");
    expect(gh.phaseFor(-5).tone).toBe("blue");
    expect(gh.phaseFor(-7).tone).toBe("night");
  });
});

describe("Timelapse core", () => {
  const tl = loadCore("public/timelapse/core.js", "TimelapseCore");
  const baseState = () => ({
    body: "fx3", method: "sq", mode: "settings",
    sqRate: 4, tlInterval: 4, ivInterval: 4,
    fps: 30, rollSeconds: 1800, clipSeconds: 20,
    movieFormat: "s4k-100", photoFormat: "craw",
  });
  const run = (patch: Record<string, unknown>) => {
    const state = { ...baseState(), ...patch };
    const core = tl.bind(state);
    core.normalize();
    return { state, core, result: core.compute() };
  };
  const errors = (result: { notes: { tone: string; text: string }[] }) => result.notes.filter((n) => n.tone === "error");

  it("matches Sony's S&Q quick-motion table at 29.97p", () => {
    // Sony: 1 fps = 30× quick, 8 fps = 3.75× quick (nominal rates).
    expect(run({ sqRate: 1 }).result.speed).toBe(30);
    expect(run({ sqRate: 8 }).result.speed).toBe(3.75);
  });

  it("offers only quick-motion S&Q rates below the record rate", () => {
    const { core } = run({ fps: 24 });
    expect(core.usableSettings().map((s: { value: number }) => s.value)).toEqual([15, 8, 4, 2, 1]);
  });

  it("works out clip length from a setting", () => {
    const { result } = run({ sqRate: 4, rollSeconds: 1800 });
    expect(result.frames).toBe(7200);
    expect(result.clip).toBe(240);
  });

  it("refuses an S&Q plan slower than 1 fps and points at the other methods", () => {
    const { result } = run({ mode: "clip", clipSeconds: 20, rollSeconds: 1800 });
    expect(result.valid).toBe(false);
    expect(errors(result)[0]?.text).toMatch(/can’t go slower than 1 fps/);
  });

  it("snaps a clip-length plan to a real setting and says exactly how long to roll", () => {
    const { state, result } = run({ mode: "clip", clipSeconds: 20, rollSeconds: 700 });
    expect(state.sqRate).toBe(1);
    expect(result.roll).toBe(600);
    expect(result.clip).toBe(20);
    expect(result.notes.some((n: { tone: string }) => n.tone === "info")).toBe(true);
  });

  it("gives interval stills whole seconds and an exact shot count", () => {
    const { state, result, core } = run({ body: "a7v", method: "iv", mode: "clip", clipSeconds: 20, rollSeconds: 1900 });
    expect(state.ivInterval).toBe(3);
    expect(result.frames).toBe(600);
    expect(result.roll).toBe(1800);
    expect(core.menuRows(result)).toContainEqual(["Number of Shots", "600"]);
  });

  it("caps 4K in-camera time-lapse at 5 s and lets HD go to 60 s", () => {
    const k4 = run({ body: "a7v", method: "tl", mode: "clip", clipSeconds: 20, rollSeconds: 7200, movieFormat: "s4k-100" });
    expect(k4.result.valid).toBe(false);
    expect(errors(k4.result)[0]?.text).toMatch(/4K time-lapse stops at 5 s/);
    const hd = run({ body: "a7v", method: "tl", mode: "clip", clipSeconds: 20, rollSeconds: 7200, movieFormat: "shd" });
    expect(hd.result.valid).toBe(true);
    expect(hd.state.tlInterval).toBe(10);
    expect(hd.core.usableSettings().some((s: { value: number }) => s.value === 60)).toBe(true);
  });

  it("keeps Time-lapse to the bodies that have it", () => {
    expect(tl.BODIES.fx3.methods).not.toContain("tl");
    expect(tl.BODIES.a1.methods).not.toContain("tl");
    for (const id of ["a7v", "a1ii", "a9iii"]) expect(tl.BODIES[id].methods).toContain("tl");
    const { state } = run({ body: "fx3", method: "tl" });
    expect(state.method).not.toBe("tl");
  });

  it("flags interval runs past 9,999 shots", () => {
    const { result } = run({ body: "a1", method: "iv", ivInterval: 1, rollSeconds: 3 * 3600 });
    expect(errors(result)[0]?.text).toMatch(/9,999/);
  });

  it("estimates card space from bitrate for movies and file size for stills", () => {
    const movie = run({ sqRate: 1, rollSeconds: 600, movieFormat: "s4k-100" }).result;
    expect(movie.cardMb).toBeCloseTo((20 * 100) / 8);
    const stills = run({ body: "a7v", method: "iv", ivInterval: 4, rollSeconds: 400, photoFormat: "craw" }).result;
    expect(stills.cardMb).toBe(100 * 35);
  });
});

describe("Board manifest", () => {
  const manifest = JSON.parse(readFileSync("public/board-sizes/boards.json", "utf8"));

  it("is valid and every generated file is fresh", () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(readFileSync("public/board-sizes/data.js", "utf8")).toBe(renderDataJs(manifest));
    const outputs: Record<string, string> = renderAll(readFileSync("public/board-sizes/boards.json", "utf8"));
    for (const [path, text] of Object.entries(outputs)) {
      expect(readFileSync(path, "utf8") === text, `${path} is stale: run node scripts/build-board-sizes.mjs`).toBe(true);
    }
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
    const dup = structuredClone(manifest);
    dup.venues[0].displays[0].zones[1].id = dup.venues[0].displays[0].zones[0].id;
    expect(validateManifest(dup).join("\n")).toMatch(/duplicate id camp-randall\/north-board\/fullscreen-fg/);
  });

  it("rejects a position outside its display and an unknown issue kind", () => {
    const bad = structuredClone(manifest);
    bad.venues[0].displays[0].zones[3].at = [{ x: 5000, y: 0 }];
    bad.venues[1].displays[0].issues[0].kind = "maybe";
    const problems = validateManifest(bad).join("\n");
    expect(problems).toMatch(/Main Video-FG: at x 5000, y 0 falls outside the display/);
    expect(problems).toMatch(/unknown issue kind maybe/);
  });

  it("keeps layouts to zones that exist on the board and don't overlap", () => {
    const north = manifest.venues[0].displays.find((d: { id: string }) => d.id === "camp-randall/north-board");
    expect(north.layouts.map((l: { id: string }) => l.id)).toEqual(["fullscreen", "main-frames", "main-wings", "main-short-wings", "main-ads"]);
    const bad = structuredClone(manifest);
    const layouts = bad.venues[0].displays.find((d: { id: string }) => d.id === "camp-randall/north-board").layouts;
    layouts[1].zones.push("camp-randall/north-board/wing-left-fg");
    layouts[2].zones.push("camp-randall/north-board/nope");
    const problems = validateManifest(bad).join("\n");
    expect(problems).toMatch(/layout main-frames: camp-randall\/north-board\/frame-left overlaps camp-randall\/north-board\/wing-left-fg/);
    expect(problems).toMatch(/layout main-wings: no zone camp-randall\/north-board\/nope on this display/);
  });

  it("keeps the stable canvas keys production tools build against", () => {
    const keys = manifest.canvases.map((c: { key: string }) => c.key);
    expect(keys).toHaveLength(58);
    for (const key of ["MAIN_FULL", "MAIN_HD", "FASCIA_FULL", "KELLNER_AD_4", "IPTV_L_WRAP", "KC_MAIN", "KC_FASCIA", "FH_MAIN", "LB_MAIN"]) expect(keys).toContain(key);
    const by = (key: string) => manifest.canvases.find((c: { key: string }) => c.key === key);
    expect(by("FASCIA_FULL")).toMatchObject({ w: 11880, h: 108, fps: 60 });
    expect(by("KC_MAIN")).toMatchObject({ w: 1104, h: 624 });
    expect(by("KC_FASCIA")).toMatchObject({ w: 12576, h: 144 });
  });

  it("catches a canvas that drifts from its board", () => {
    const drifted = structuredClone(manifest);
    drifted.canvases.find((c: { key: string }) => c.key === "KC_MAIN").h = 621;
    expect(validateManifest(drifted).join("\n")).toMatch(/KC_MAIN: 1104x621 but Centerhung Main is 1104x624/);
  });
});

describe("Board Sizes data", () => {
  const data = loadCore("public/board-sizes/data.js", "BOARD_DATA");
  type Issue = { kind: string; field?: string; text: string };
  type Zone = { id: string; n: number; name: string; w: number; h: number; at?: { x: number; y: number }[]; atFrom?: string; notes?: string[]; issues?: Issue[] };
  type Display = { id: string; name: string; processor?: string; w: number; h: number; zones: Zone[]; sources: Record<string, string>; notes?: string[]; issues?: Issue[] };
  type Venue = { name: string; displays: Display[] };
  const venues: Venue[] = data.venues;
  const display = (venue: string, name: string) =>
    venues.find((v) => v.name === venue)!.displays.find((d) => d.name === name)!;

  it("covers every venue across the four sources", () => {
    expect(venues.map((v) => v.name)).toEqual(["Camp Randall", "Kohl Center", "Field House", "LaBahn Arena", "Goodman Diamond"]);
    expect(Object.keys(data.sources)).toEqual(["sheet", "guide", "colosseum", "builder"]);
    expect(venues.map((v) => v.displays.reduce((n, d) => n + d.zones.length, 0))).toEqual([81, 91, 24, 0, 0]);
  });

  it("keeps the Board Info sheet's zones verbatim and in sheet order", () => {
    for (const v of venues) {
      for (const d of v.displays) {
        if (!d.sources.sheet) continue;
        expect(d.processor).toMatch(/^[A-Z]{2}-[A-Za-z]+-P$/);
        d.zones.forEach((z, i) => expect(z.n, `${d.name}`).toBe(i + 1));
      }
    }
  });

  it("places every zone inside its display and says where each position came from", () => {
    for (const v of venues) {
      for (const d of v.displays) {
        expect(Object.keys(d.sources).length, `${d.name} has no source`).toBeGreaterThan(0);
        for (const z of d.zones) {
          expect(z.w <= d.w && z.h <= d.h, `${d.name} / ${z.name} is larger than its display`).toBe(true);
          for (const { x, y } of z.at ?? []) {
            expect(["sheet", "guide", "builder", "derived"]).toContain(z.atFrom);
            expect(y >= 0 && x >= 0 && y + z.h <= d.h && x + z.w <= d.w, `${d.name} / ${z.name} at ${x},${y}`).toBe(true);
          }
        }
      }
    }
  });

  it("matches the Board Builder's North Board geometry", () => {
    const north = display("Camp Randall", "North Board");
    const at = (name: string) => north.zones.find((z) => z.name === name)!.at![0];
    expect(at("Main Video-FG")).toEqual({ x: 1332, y: 0 });
    expect(at("Frame-Right")).toEqual({ x: 4428, y: 0 });
    expect(at("Stat Box-Left-FG")).toEqual({ x: 612, y: 828 });
    expect(at("Stat Box-Right-FG")).toEqual({ x: 4428, y: 828 });
    expect(at("Wing Short-Right-FG")).toEqual({ x: 5148, y: 0 });
    expect(at("Ad-Bottom Right")).toEqual({ x: 5148, y: 1030 });
  });

  it("carries the 2024 guide's safe areas and the sources' open questions", () => {
    const feed = display("Camp Randall", "North Board HD feed");
    expect(feed.zones[0]).toMatchObject({ w: 1920, h: 806, at: [{ x: 0, y: 94 }] });
    expect(94 + 806 + 180).toBe(feed.h);
    const north = display("Camp Randall", "North Board");
    expect(north.zones.find((z) => z.name === "GIP")!.issues).toEqual([expect.objectContaining({ kind: "tbd", field: "h" })]);
    expect(display("Kohl Center", "360 Fascia").notes!.join(" ")).toMatch(/72 px high/);
    expect(display("Kohl Center", "360 Fascia").issues).toEqual([expect.objectContaining({ kind: "conflict", field: "fps", text: expect.stringMatching(/59\.94/) })]);
    expect(display("Kohl Center", "Main 16:9 feed").issues!.map((i) => i.kind)).toEqual(["unconfirmed", "conflict"]);
    expect(display("Field House", "Table").issues!.map((i) => i.text).join(" ")).toMatch(/Left GIP-BG.*twice/);
    expect(display("Goodman Diamond", "Main").issues!.map((i) => i.kind)).toEqual(["unconfirmed"]);
    expect(display("Goodman Diamond", "Main")).toMatchObject({ w: 560, h: 308, sources: { colosseum: expect.any(String) } });
  });

  it("maps every content type onto boards that exist", () => {
    type Target = { venue: string; display: string; zones: string[] | null };
    type Content = { id: string; name: string; targets: Target[]; draft?: boolean };
    const base = (n: string) => n.replace(/[-\s]+(FG|BG)$/, "").replace(/-\s+/, "-");
    const broad: Content[] = data.content.broad;
    const gameDay: Content[] = data.content.gameDay.flatMap((g: { items: Content[] }) => g.items);
    expect(broad.map((c) => c.id)).toEqual(["full-system", "sponsor-ad", "main-board-video", "iptv"]);
    expect(broad.every((c) => c.draft)).toBe(true);
    expect(gameDay).toHaveLength(27);
    const ids = new Set<string>();
    for (const c of [...broad, ...gameDay]) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.targets.length, c.name).toBeGreaterThan(0);
      for (const t of c.targets) {
        const d = display(venues.find((v) => (v as unknown as { id: string }).id === t.venue)!.name, t.display);
        expect(d, `${c.name}: ${t.display}`).toBeTruthy();
        for (const z of t.zones ?? []) expect(d.zones.map((x) => base(x.name)), `${c.name}: ${t.display} › ${z}`).toContain(z);
      }
    }
    const touchdown = gameDay.find((c) => c.id === "score-touchdown")!;
    expect(touchdown.targets.some((t) => t.display === "North Board HD feed")).toBe(true);
  });
});

describe("Board Sizes agent files", () => {
  const index = JSON.parse(readFileSync("public/board-sizes/index.json", "utf8"));
  const manifest = JSON.parse(readFileSync("public/board-sizes/boards.json", "utf8"));
  type Board = { id: string; type: string; w: number; h: number; fps: number | null; canvasKeys: string[]; issues: { kind: string }[]; url: string };
  const board = (id: string): Board => index.boards.find((b: Board) => b.id === id);

  it("flattens every display and zone with the manifest version and hash", () => {
    expect(index).toMatchObject({ schema: "wisconsin-board-sizes-index/1", version: manifest.version });
    expect(index.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(index.boards).toHaveLength(223);
    expect(board("camp-randall/north-board/main-video-fg")).toMatchObject({ type: "zone", w: 3096, h: 1440, fps: 60, canvasKeys: ["MAIN_VIDEO"] });
    expect(board("kohl-center/centerhung-main")).toMatchObject({ type: "display", w: 1104, h: 624, fps: 59.94, canvasKeys: ["KC_MAIN"] });
    expect(board("camp-randall/north-board").canvasKeys).toEqual(["MAIN_FULL", "DAILY_MAIN_FULL"]);
    expect(board("kohl-center/centerhung-main/fullscreen-fg").issues.map((i) => i.kind)).toEqual(["conflict"]);
    expect(board("goodman/main").url).toBe("https://wisconsincreative.com/board-sizes?v=goodman#goodman/main");
  });

  it("resolves every canvas key and content type to board ids", () => {
    const ids = new Set(index.boards.map((b: Board) => b.id));
    expect(index.canvases).toHaveLength(58);
    for (const c of index.canvases) expect(ids.has(c.zoneId ?? c.displayId), c.key).toBe(true);
    for (const c of index.content) {
      expect(c.boards.length, c.id).toBeGreaterThan(0);
      for (const id of c.boards) expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  it("tells agents the rules and lists every open issue", () => {
    const llms = readFileSync("public/board-sizes/llms.txt", "utf8");
    expect(llms).toMatch(/^# Wisconsin Board Sizes\n/);
    expect(llms).toContain(`Manifest ${manifest.version}`);
    expect(llms).toContain("Never hardcode or guess a board size");
    for (const b of index.boards) if (b.type === "display") expect(llms).toContain(`id \`${b.id}\``);
    expect(llms).toContain("`camp-randall/north-board/gip` (tbd, h)");
  });

  it("publishes a JSON Schema that describes the manifest", () => {
    const schema = JSON.parse(readFileSync("public/board-sizes/boards.schema.json", "utf8"));
    expect(schema.properties.schema.const).toBe(manifest.schema);
    for (const key of schema.required) expect(manifest, key).toHaveProperty(key);
    expect(schema.$defs.issues.items.properties.kind.enum).toEqual(["conflict", "tbd", "unconfirmed", "naming"]);
  });
});

describe("Board Sizes page", () => {
  const app = readFileSync("public/board-sizes/app.js", "utf8");
  it("hides the way back to the site on shared links", () => {
    expect(app).toMatch(/share(:| =) params\.get\('share'\) === '1'/);
    expect(app).toMatch(/if \(state\.share\) \{[^}]*el\['side-foot'\]\.hidden = true;/);
    expect(readFileSync("public/board-sizes/index.html", "utf8")).toMatch(/<div class="side-foot" id="side-foot">\s*<a href="\/tools"/);
  });
  it("only shows the AE template button once a link is configured", () => {
    expect(app).toContain("if (DATA.links && DATA.links.aeTemplate)");
  });
});

