#!/usr/bin/env node
// Builds the Board Sizes site data and agent files from their single source.
//
// public/board-sizes/boards.json is the one place board sizes are edited. It is
// published as-is at /board-sizes/boards.json for production tools (the After
// Effects Board Builder pins a copy of it). This script validates it, then
// regenerates everything derived from it:
//   data.js     the same data wrapped for the page
//   index.json  one flat record per display and zone, resolved for lookups
//   boards.csv  the same records as a spreadsheet
//   llms.txt    how agents should use all of this, plus every size
// and restamps the page's script hashes. Run `node scripts/build-board-sizes.mjs`
// after an edit; `--check` exits 1 when a generated file is stale or the
// manifest is invalid. tests/static-tools.test.ts runs the same checks.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { stamp } from "./hash-static-tools.mjs";

export const MANIFEST_PATH = "public/board-sizes/boards.json";
export const DATA_PATH = "public/board-sizes/data.js";
export const INDEX_PATH = "public/board-sizes/index.json";
export const CSV_PATH = "public/board-sizes/boards.csv";
export const LLMS_PATH = "public/board-sizes/llms.txt";
export const PAGE_PATH = "public/board-sizes/index.html";
export const SITE = "https://wisconsincreative.com/board-sizes";

export const ISSUE_KINDS = {
  conflict: "Sources disagree",
  tbd: "Value not final",
  unconfirmed: "Single source, unconfirmed",
  naming: "Names may change",
};
const POSITION_SOURCES = ["sheet", "guide", "builder", "derived"];
const LAYER = /[-\s]+(FG|BG)$/;

const DATA_HEADER = `/* Board Sizes data. GENERATED from boards.json by
   scripts/build-board-sizes.mjs: edit boards.json, not this file. */
`;

export function renderDataJs(manifest) {
  const data = { ...manifest };
  delete data.$comment;
  return `${DATA_HEADER}(function (root) {
  'use strict';
  var BOARD_DATA = ${JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")};
  root.BOARD_DATA = BOARD_DATA;
  if (typeof module === 'object' && module.exports) module.exports = BOARD_DATA;
})(typeof window !== 'undefined' ? window : this);
`;
}

const positiveInt = (n) => Number.isInteger(n) && n > 0;
const positive = (n) => typeof n === "number" && isFinite(n) && n > 0;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

function checkIssues(list, at, problems) {
  if (list === undefined) return;
  if (!Array.isArray(list) || !list.length) return problems.push(`${at}: issues must be a non-empty list`);
  for (const i of list) {
    if (!ISSUE_KINDS[i.kind]) problems.push(`${at}: unknown issue kind ${i.kind}`);
    if (typeof i.text !== "string" || !i.text) problems.push(`${at}: issue needs text`);
  }
}

// Returns a list of problems; empty means the manifest is usable.
export function validateManifest(manifest) {
  const problems = [];
  if (manifest.schema !== "wisconsin-board-sizes/1") problems.push(`unknown schema ${manifest.schema}`);
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(manifest.version ?? "")) problems.push(`version must look like 2026-09-24.1, got ${manifest.version}`);
  if (manifest.changes?.[0]?.version !== manifest.version) problems.push(`changes must start with an entry for ${manifest.version}`);
  const ids = new Set();
  const claim = (id, at) => {
    if (!ID.test(id ?? "")) problems.push(`${at}: id "${id}" must be lowercase slugs joined by /`);
    else if (ids.has(id)) problems.push(`${at}: duplicate id ${id}`);
    ids.add(id);
  };
  for (const v of manifest.venues ?? []) {
    claim(v.id, `venue ${v.name}`);
    for (const d of v.displays ?? []) {
      const at = `${v.name} / ${d.name}`;
      claim(d.id, at);
      if (!d.id?.startsWith(`${v.id}/`)) problems.push(`${at}: id must start with ${v.id}/`);
      if (!positiveInt(d.w) || !positiveInt(d.h)) problems.push(`${at}: w and h must be positive integers`);
      if (!Object.keys(d.sources ?? {}).length) problems.push(`${at}: needs at least one source`);
      checkIssues(d.issues, at, problems);
      for (const z of d.zones ?? []) {
        const zat = `${at} / ${z.name}`;
        claim(z.id, zat);
        if (!z.id?.startsWith(`${d.id}/`)) problems.push(`${zat}: id must start with ${d.id}/`);
        if (!positiveInt(z.w) || !positiveInt(z.h)) problems.push(`${zat}: w and h must be positive integers`);
        if (z.w > d.w || z.h > d.h) problems.push(`${zat}: ${z.w}x${z.h} is larger than the display`);
        if (z.at && !POSITION_SOURCES.includes(z.atFrom)) problems.push(`${zat}: atFrom must be one of ${POSITION_SOURCES.join(", ")}`);
        for (const p of z.at ?? []) {
          if (!(p.x >= 0 && p.y >= 0 && p.x + z.w <= d.w && p.y + z.h <= d.h)) problems.push(`${zat}: at x ${p.x}, y ${p.y} falls outside the display`);
        }
        checkIssues(z.issues, zat, problems);
      }
    }
  }
  const seen = new Set();
  for (const c of manifest.canvases ?? []) {
    const at = `canvas ${c.key}`;
    if (!/^[A-Z][A-Z0-9_]*$/.test(c.key ?? "")) problems.push(`${at}: key must be UPPER_SNAKE`);
    if (seen.has(c.key)) problems.push(`${at}: duplicate key`);
    seen.add(c.key);
    if (!positiveInt(c.w) || !positiveInt(c.h)) problems.push(`${at}: w and h must be positive integers`);
    if (c.fps !== undefined && !positive(c.fps)) problems.push(`${at}: fps must be positive`);
    if (c.duration !== undefined && !positive(c.duration)) problems.push(`${at}: duration must be positive`);
    if (c.safeInset !== undefined && !(positiveInt(c.safeInset) && c.safeInset * 2 < Math.min(c.w, c.h))) problems.push(`${at}: bad safeInset`);
    if (typeof c.source !== "string" || !c.source) problems.push(`${at}: source is required`);
    const venue = manifest.venues.find((v) => v.id === c.venue);
    const display = venue?.displays.find((d) => d.name === c.display);
    if (!display) {
      problems.push(`${at}: no display "${c.display}" in venue ${c.venue}`);
      continue;
    }
    if (c.zone !== undefined) {
      const zone = display.zones.find((z) => z.name === c.zone);
      if (!zone) problems.push(`${at}: no zone "${c.zone}" in ${c.display}`);
      else if (zone.w !== c.w || zone.h !== c.h) problems.push(`${at}: ${c.w}x${c.h} but ${c.display} / ${c.zone} is ${zone.w}x${zone.h}`);
    } else if (c.within) {
      if (c.w > display.w || c.h > display.h) problems.push(`${at}: ${c.w}x${c.h} does not fit inside ${c.display} ${display.w}x${display.h}`);
    } else if (display.w !== c.w || display.h !== c.h) {
      problems.push(`${at}: ${c.w}x${c.h} but ${c.display} is ${display.w}x${display.h}`);
    }
  }
  return problems;
}

/* ---------------- derived records ---------------- */

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
export function aspect(w, h) {
  const g = gcd(w, h), a = w / g, b = h / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  return w >= h ? `${Math.round((w / h) * 100) / 100}:1` : `1:${Math.round((h / w) * 100) / 100}`;
}
const num = (s) => { const f = parseFloat(s); return isFinite(f) && f > 0 ? f : null; };
const url = (venue, id) => `${SITE}?v=${venue}#${id}`;

// Canvas key → the display or zone it is built from.
function canvasTargets(manifest) {
  const byId = {};
  for (const c of manifest.canvases) {
    const v = manifest.venues.find((x) => x.id === c.venue);
    const d = v.displays.find((x) => x.name === c.display);
    const z = c.zone !== undefined ? d.zones.find((x) => x.name === c.zone) : null;
    const id = z ? z.id : d.id;
    // A `within` canvas is a region of the display, not the display itself.
    if (!c.within) (byId[id] ??= []).push(c);
    c._target = { displayId: d.id, zoneId: z ? z.id : null, within: !!c.within };
  }
  return byId;
}

export function buildIndex(manifest, manifestBytes) {
  const m = structuredClone(manifest);
  const keysFor = canvasTargets(m);
  const sources = (d) => Object.keys(d.sources ?? {}).map((k) => ({ source: k, label: m.sources[k].label, ref: d.sources[k] }));
  const boards = [];
  for (const v of m.venues) {
    for (const d of v.displays) {
      const del = d.delivery ?? {};
      const fpsOf = (id) => (keysFor[id] ?? []).find((c) => c.fps && !c.within)?.fps ?? num(del.fps);
      const base = {
        venue: v.id, venueName: v.name, displayId: d.id, display: d.name,
        processor: d.processor ?? null, group: d.group ?? null,
      };
      const delivery = {
        video: del.video ?? null, still: del.still ?? null, audio: del.audio ?? null,
        duration: del.duration ?? null,
      };
      boards.push({
        id: d.id, type: "display", ...base, zone: null, layer: null,
        w: d.w, h: d.h, aspect: aspect(d.w, d.h), at: [{ x: 0, y: 0 }], atFrom: null,
        fps: fpsOf(d.id), stillOnly: false, ...delivery, pad: null,
        canvasKeys: (keysFor[d.id] ?? []).map((c) => c.key),
        zoneCount: d.zones.length, sources: sources(d),
        issues: d.issues ?? [], notes: d.notes ?? [], url: url(v.id, d.id),
      });
      for (const z of d.zones) {
        const layer = LAYER.exec(z.name);
        boards.push({
          id: z.id, type: "zone", ...base, zone: z.name, zoneNumber: z.n ?? null, layer: layer ? layer[1] : null,
          w: z.w, h: z.h, aspect: aspect(z.w, z.h), at: z.at ?? [], atFrom: z.atFrom ?? null,
          fps: z.stillOnly ? null : fpsOf(z.id), stillOnly: !!z.stillOnly, ...delivery,
          duration: z.duration ?? delivery.duration, pad: z.pad ?? null, guidePage: z.page ?? null,
          canvasKeys: (keysFor[z.id] ?? []).map((c) => c.key),
          sources: sources(d), issues: [...(z.issues ?? []), ...(d.issues ?? [])],
          notes: z.notes ?? [], url: url(v.id, z.id),
        });
      }
    }
  }
  const canvases = m.canvases.map(({ _target, ...c }) => ({ ...c, ..._target, url: url(c.venue, _target.zoneId ?? _target.displayId) }));
  const content = [
    ...m.content.broad.map((c) => ({ ...c, kind: "broad" })),
    ...m.content.gameDay.flatMap((g) => g.items.map((c) => ({ ...c, kind: "gameDay", group: g.name }))),
  ].map((c) => ({
    id: c.id, name: c.name, kind: c.kind, group: c.group ?? null, draft: !!c.draft, duration: c.duration ?? null,
    boards: c.targets.flatMap((t) => {
      const d = m.venues.find((v) => v.id === t.venue).displays.find((x) => x.name === t.display);
      if (!t.zones) return [d.id];
      return t.zones.flatMap((zb) => d.zones.filter((z) => z.name.replace(LAYER, "").replace(/-\s+/, "-") === zb && !/-BG$/.test(z.name)).map((z) => z.id));
    }),
    url: `${SITE}?c=${c.id}`,
  }));
  return {
    $comment: "GENERATED from boards.json by scripts/build-board-sizes.mjs. One record per display and zone; read llms.txt for how to use it.",
    schema: "wisconsin-board-sizes-index/1",
    version: m.version,
    updated: m.updated,
    manifest: { url: `${SITE}/boards.json`, schema: m.schema, sha256: createHash("sha256").update(manifestBytes).digest("hex") },
    conventions: {
      units: "px", size: "w × h", position: "at[] = {x, y} of each placement from the display's top-left; a display's own at is {x: 0, y: 0}",
      fps: "delivery frame rate where a source states one, else null (59.94 is the house default for AE work)",
      layer: "FG / BG for processor layer pairs; build one asset per pair unless the content needs both",
      issues: ISSUE_KINDS,
    },
    venues: m.venues.map((v) => ({ id: v.id, name: v.name, code: v.code, displays: v.displays.map((d) => d.id), notes: v.notes ?? [] })),
    boards, canvases, content,
  };
}

// Pretty at the top, one record per line in the lists: small, diffable, and
// `grep camp-randall/north-board index.json` returns whole records.
export function renderIndexJson(index) {
  const out = Object.entries(index).map(([k, v]) => {
    const value = Array.isArray(v) && v.length && typeof v[0] === "object"
      ? `[\n    ${v.map((x) => JSON.stringify(x)).join(",\n    ")}\n  ]`
      : JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");
    return `  ${JSON.stringify(k)}: ${value}`;
  });
  return `{\n${out.join(",\n")}\n}\n`;
}

function csvCell(s) { s = String(s ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
export function renderCsv(index) {
  const head = ["id", "type", "venue", "display", "zone", "layer", "w", "h", "aspect", "at (x,y)", "fps", "still only", "video", "still", "duration", "pad", "canvas keys", "issues", "url"];
  const rows = index.boards.map((b) => [
    b.id, b.type, b.venueName, b.display, b.zone, b.layer, b.w, b.h, b.aspect,
    b.at.map((p) => `${p.x},${p.y}`).join(" | "), b.fps, b.stillOnly ? "yes" : "", b.video, b.still, b.duration, b.pad,
    b.canvasKeys.join(" "), b.issues.map((i) => `${i.kind}: ${i.text}`).join(" / "), b.url,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export function renderLlms(manifest, index) {
  const L = [];
  const fmt = (b) => `${b.w}x${b.h}`;
  L.push(
    "# Wisconsin Board Sizes",
    "",
    `> Every video board, ribbon, table and IPTV canvas at Camp Randall, the Kohl Center, the Field House, LaBahn Arena and Goodman Diamond (Wisconsin Athletics). Manifest ${manifest.version}, updated ${manifest.updated}.`,
    "",
    "Use this whenever you create or check anything that will play on a Wisconsin venue board: After Effects comps, Photoshop/Illustrator artboards, templates, render presets, code that lays out or validates board content, and sponsor or Colosseum deliverables.",
    "",
    "## Rules for agents",
    "",
    "1. Never hardcode or guess a board size. Look it up here every time; read `version` and say which one you used.",
    "2. Refer to boards by `id` (e.g. `camp-randall/north-board/main-video-fg`), or by canvas `key` (e.g. `MAIN_VIDEO`) in production tools. Names can carry typos from the processor; ids and keys never change.",
    "3. Positions are `{x, y}` from the display's top-left. Sizes are width × height in pixels.",
    "4. Check `issues` before final delivery. `conflict` = sources disagree, `tbd` = value not final, `unconfirmed` = only one source, `naming` = zone names may change. Surface them to the user; never resolve one silently.",
    "5. Respect delivery specs: `fps`, `stillOnly`, `duration`, `pad` (keep content that many px inside every edge), `audio`. When `fps` is null, ask or use 59.94.",
    "6. FG/BG zones are two processor layers of one window. Build one asset unless the content needs both.",
    "7. To change a size, edit `public/board-sizes/boards.json` in the Wisconsin Creative repo and run `node scripts/build-board-sizes.mjs`. Never edit the generated files.",
    "",
    "## Files",
    "",
    `- [index.json](${SITE}/index.json): start here. One flat record per display and zone (${index.boards.length}), with id, size, aspect, positions, fps, delivery, canvas keys, issues and a deep link. Also canvases and content types resolved to ids.`,
    `- [boards.json](${SITE}/boards.json): the hand-edited source (schema \`${manifest.schema}\`). Pin this exact file for production tools; the After Effects Board Builder does.`,
    `- [boards.schema.json](${SITE}/boards.schema.json): JSON Schema for boards.json.`,
    `- [boards.csv](${SITE}/boards.csv): index.json as a spreadsheet.`,
    `- [Board Sizes](${SITE}): the human page. \`?v=<venue>#<id>\` opens one board; \`?c=<content id>\` lists every canvas a piece of content needs.`,
    "",
    "## Lookup recipes",
    "",
    "```js",
    `const idx = await (await fetch("${SITE}/index.json")).json();`,
    `const board = idx.boards.find((b) => b.id === "camp-randall/north-board/main-video-fg"); // { w: 3096, h: 1440, fps: 60, ... }`,
    `const byKey = idx.canvases.find((c) => c.key === "KC_MAIN");`,
    `const touchdown = idx.content.find((c) => c.id === "score-touchdown").boards.map((id) => idx.boards.find((b) => b.id === id));`,
    "```",
    "",
    "```python",
    "import json, urllib.request",
    `idx = json.load(urllib.request.urlopen("${SITE}/index.json"))`,
    `sizes = {b["id"]: (b["w"], b["h"]) for b in idx["boards"]}`,
    "```",
    "",
    "After Effects: use the Board Builder (pins boards.json with the `boards` CLI), or the site's \"AE comps\" button on any content type.",
    "",
  );
  const open = manifest.venues.flatMap((v) => v.displays.flatMap((d) => [
    ...(d.issues ?? []).map((i) => [d.id, i]),
    ...d.zones.flatMap((z) => (z.issues ?? []).map((i) => [z.id, i])),
  ]));
  if (open.length) {
    L.push("## Open issues", "", "Zones inherit their display's issues in index.json.", "");
    const same = new Map();
    for (const [id, i] of open) {
      const k = `${i.kind}|${i.field ?? ""}|${i.text}`;
      if (!same.has(k)) same.set(k, { i, ids: [] });
      same.get(k).ids.push(id);
    }
    for (const { i, ids } of same.values()) L.push(`- ${ids.map((id) => `\`${id}\``).join(", ")} (${i.kind}${i.field ? `, ${i.field}` : ""}): ${i.text}`);
    L.push("");
  }
  for (const v of manifest.venues) {
    L.push(`## ${v.name} (\`${v.id}\`)`, "");
    for (const n of v.notes ?? []) L.push(`- ${n}`);
    if (v.notes?.length) L.push("");
    for (const d of v.displays) {
      const rec = index.boards.find((b) => b.id === d.id);
      const spec = [rec.fps ? `${rec.fps} fps` : null, rec.video, rec.duration].filter(Boolean).join(" · ");
      L.push(`### ${d.name}: ${fmt(d)}${d.processor ? ` (${d.processor})` : ""}`, "");
      L.push(`id \`${d.id}\` · ${rec.aspect}${spec ? ` · ${spec}` : ""}${rec.canvasKeys.length ? ` · keys ${rec.canvasKeys.map((k) => `\`${k}\``).join(", ")}` : ""}`);
      for (const i of d.issues ?? []) L.push(`- ⚠ ${i.kind}: ${i.text}`);
      L.push("");
      if (d.zones.length) {
        L.push("| zone id | size | at (x,y) | fps | keys |", "|---|---|---|---|---|");
        for (const z of d.zones) {
          const zr = index.boards.find((b) => b.id === z.id);
          const tags = [zr.stillOnly ? "stills" : zr.fps ? String(zr.fps) : "", zr.pad ? `pad ${zr.pad}` : "", z.issues ? `⚠ ${z.issues.map((i) => i.kind).join(", ")}` : ""].filter(Boolean).join(" · ");
          L.push(`| \`${z.id.slice(d.id.length + 1)}\` | ${fmt(z)} | ${zr.at.map((p) => `${p.x},${p.y}`).join(" ") || "–"} | ${tags || "–"} | ${zr.canvasKeys.join(" ") || "–"} |`);
        }
        L.push("");
      }
    }
  }
  L.push("## Changes", "");
  for (const c of manifest.changes) L.push(`- ${c.version}: ${c.summary}`);
  L.push("");
  return L.join("\n");
}

export function renderAll(manifestBytes) {
  const manifest = JSON.parse(manifestBytes);
  const index = buildIndex(manifest, manifestBytes);
  return {
    [DATA_PATH]: renderDataJs(manifest),
    [INDEX_PATH]: renderIndexJson(index),
    [CSV_PATH]: renderCsv(index),
    [LLMS_PATH]: renderLlms(manifest, index),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const bytes = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(bytes);
  const problems = validateManifest(manifest);
  if (problems.length) {
    console.error(`${MANIFEST_PATH} is invalid:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const outputs = renderAll(bytes);
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const stale = Object.keys(outputs).filter((p) => read(p) !== outputs[p]);
  if (check) {
    for (const p of stale) console.error(`${p} is stale: run node scripts/build-board-sizes.mjs`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const p of stale) writeFileSync(p, outputs[p]);
  const page = readFileSync(PAGE_PATH, "utf8");
  const stamped = stamp(PAGE_PATH);
  if (stamped !== page) writeFileSync(PAGE_PATH, stamped);
  for (const p of Object.keys(outputs)) console.log(`${stale.includes(p) ? "wrote    " : "unchanged"} ${p}`);
  console.log(`manifest ${manifest.version}: ${manifest.canvases.length} canvases`);
}
