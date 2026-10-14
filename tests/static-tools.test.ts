import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations
import { HASHED_TOOLS, stamp } from "../scripts/hash-static-tools.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadCore(path: string, name: string): any {
  const context: { window: Record<string, unknown> } = { window: {} };
  runInNewContext(readFileSync(path, "utf8"), context);
  return context.window[name];
}

const nextConfigSource = readFileSync("next.config.ts", "utf8");
const TOOLS = ["golden-hour", "timelapse", "board-sizes"] as const;

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
      ["app.js", "boards.csv", "boards.json", "boards.schema.json", "data.js", "design", "index.html", "index.json", "llms.txt"],
    );
    expect(readdirSync("public/apps").sort()).toEqual(["icons", "motion-w.svg"]);
  });

  it("links every tool back to the apps page", () => {
    for (const tool of ["golden-hour", "timelapse", "board-sizes", "qrcode"]) {
      expect(readFileSync(`public/${tool}/index.html`, "utf8"), tool).toContain('href="/apps"');
    }
  });

  it("sends the old /tools URL to the apps page", () => {
    expect(nextConfigSource).toContain('{ source: "/tools", destination: "/apps", permanent: false }');
  });

  it("lists every public tool on the apps page", () => {
    const hub = readFileSync("src/lib/apps-page.ts", "utf8");
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
