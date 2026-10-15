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
//   design/<venue>.md  one design guide per venue: that venue's boards from
//               the manifest, then the hand-written build guidance in
//               docs/board-design/<venue>.md and docs/board-design/all-venues.md
// and restamps the page's script hashes. Run `node scripts/build-board-sizes.mjs`
// after an edit; `--check` exits 1 when a generated file is stale or the
// manifest is invalid. tests/static-tools.test.ts runs the same checks.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MANIFEST_PATH = "public/board-sizes/boards.json";
export const DATA_PATH = "public/board-sizes/data.js";
export const INDEX_PATH = "public/board-sizes/index.json";
export const CSV_PATH = "public/board-sizes/boards.csv";
export const LLMS_PATH = "public/board-sizes/llms.txt";
export const PAGE_PATH = "public/board-sizes/index.html";
export const DESIGN_DIR = "public/board-sizes/design";
export const GUIDE_DIR = "docs/board-design";
export const SHARED_GUIDE = "all-venues";
export const SITE = "https://wisconsincreative.com/board-sizes";
export const SCHEMA_PATH = "public/board-sizes/boards.schema.json";

// Stamps script URLs with a content hash. public/sw.js serves .js cache-first,
// so a script URL has to change whenever the file does.
export function stampPage(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  return html.replace(/<script src="([^"?]+)\?v=[0-9a-f]{12}"><\/script>/g, (_, file) => {
    const hash = createHash("sha256").update(readFileSync(join(dirname(htmlPath), file))).digest("hex").slice(0, 12);
    return `<script src="${file}?v=${hash}"></script>`;
  });
}

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

// A layout names zones used together: each must exist on the display, and no
// two positioned zones in it may overlap.
function checkLayouts(d, at, problems) {
  if (d.layouts === undefined) return;
  if (!Array.isArray(d.layouts) || !d.layouts.length) return problems.push(`${at}: layouts must be a non-empty list`);
  const seen = new Set();
  for (const l of d.layouts) {
    const lat = `${at} / layout ${l.id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(l.id ?? "")) problems.push(`${lat}: id must be a lowercase slug`);
    if (seen.has(l.id)) problems.push(`${lat}: duplicate layout id`);
    seen.add(l.id);
    if (typeof l.name !== "string" || !l.name) problems.push(`${lat}: name is required`);
    if (!Array.isArray(l.zones) || !l.zones.length) { problems.push(`${lat}: zones must be a non-empty list`); continue; }
    const rects = [];
    for (const id of l.zones) {
      const z = d.zones.find((x) => x.id === id);
      if (!z) { problems.push(`${lat}: no zone ${id} on this display`); continue; }
      for (const p of z.at ?? []) rects.push({ id, x: p.x, y: p.y, w: z.w, h: z.h });
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) problems.push(`${lat}: ${a.id} overlaps ${b.id}`);
    }
  }
}

// Checks boards.json against boards.schema.json. Covers the keywords that
// schema uses (type, const, enum, required, additionalProperties, pattern,
// minimum, format, $ref). Empty means the document matches.
export function validateSchema(data, schema) {
  const problems = [];
  const defs = schema.$defs ?? {};
  const resolve = (node) => (node?.$ref ? defs[node.$ref.slice("#/$defs/".length)] : node);
  function check(value, raw, at) {
    const node = resolve(raw);
    if (!node) return problems.push(`${at}: unknown schema node`);
    let type = node.type;
    if (Array.isArray(type)) {
      if (value === null && type.includes("null")) return;
      type = type.find((t) => t !== "null");
    }
    if (node.const !== undefined && value !== node.const) problems.push(`${at}: expected ${JSON.stringify(node.const)}`);
    if (node.enum && !node.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} is not one of ${node.enum.join(", ")}`);
    if (type === "object") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return problems.push(`${at}: expected an object`);
      for (const key of node.required ?? []) if (!(key in value)) problems.push(`${at}: missing ${key}`);
      const props = node.properties ?? {};
      for (const key of Object.keys(value)) {
        if (props[key]) check(value[key], props[key], `${at}.${key}`);
        else if (node.additionalProperties === false) problems.push(`${at}: unexpected property ${key}`);
        else if (node.additionalProperties && typeof node.additionalProperties === "object") check(value[key], node.additionalProperties, `${at}.${key}`);
      }
      if (node.minProperties != null && Object.keys(value).length < node.minProperties) problems.push(`${at}: needs at least ${node.minProperties} properties`);
    } else if (type === "array") {
      if (!Array.isArray(value)) return problems.push(`${at}: expected an array`);
      if (node.minItems != null && value.length < node.minItems) problems.push(`${at}: needs at least ${node.minItems} items`);
      if (node.items) value.forEach((item, i) => check(item, node.items, `${at}[${i}]`));
    } else if (type === "string") {
      if (typeof value !== "string") return problems.push(`${at}: expected a string`);
      if (node.pattern && !new RegExp(node.pattern).test(value)) problems.push(`${at}: ${JSON.stringify(value)} does not match ${node.pattern}`);
      if (node.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) problems.push(`${at}: ${JSON.stringify(value)} is not a date`);
      if (node.format === "uri") { try { new URL(value); } catch { problems.push(`${at}: ${JSON.stringify(value)} is not a URI`); } }
    } else if (type === "integer") {
      if (!Number.isInteger(value)) problems.push(`${at}: expected an integer`);
      else if (node.minimum != null && value < node.minimum) problems.push(`${at}: ${value} is below ${node.minimum}`);
    } else if (type === "number") {
      if (typeof value !== "number" || !isFinite(value)) problems.push(`${at}: expected a number`);
      else if (node.exclusiveMinimum != null && !(value > node.exclusiveMinimum)) problems.push(`${at}: must be greater than ${node.exclusiveMinimum}`);
    } else if (type === "boolean") {
      if (typeof value !== "boolean") problems.push(`${at}: expected a boolean`);
    }
  }
  check(data, schema, "boards.json");
  return problems;
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
      checkLayouts(d, at, problems);
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
  const insets = new Map();
  for (const c of manifest.canvases ?? []) {
    if (c.safeInset == null) continue;
    const venue = manifest.venues.find((v) => v.id === c.venue);
    const display = venue?.displays.find((d) => d.name === c.display);
    const zone = c.zone != null ? display?.zones.find((z) => z.name === c.zone) : null;
    const id = zone ? zone.id : display?.id;
    if (!id) continue;
    const prior = insets.get(id);
    if (prior != null && prior !== c.safeInset) problems.push(`canvas safe insets disagree on ${id}: ${prior} and ${c.safeInset}`);
    insets.set(id, c.safeInset);
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
  const insetFor = (id) => {
    const values = (keysFor[id] ?? []).map((c) => c.safeInset).filter((n) => n != null);
    if (!values.length || values.some((n) => n !== values[0])) return null;
    return values[0];
  };
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
        fps: fpsOf(d.id), stillOnly: false, ...delivery, pad: null, safeInset: insetFor(d.id),
        canvasKeys: (keysFor[d.id] ?? []).map((c) => c.key),
        zoneCount: d.zones.length, sources: sources(d),
        issues: d.issues ?? [], notes: d.notes ?? [], url: url(v.id, d.id),
        layouts: (d.layouts ?? []).map((l) => ({ id: l.id, name: l.name, zones: l.zones, draft: !!l.draft })),
      });
      for (const z of d.zones) {
        const layer = LAYER.exec(z.name);
        boards.push({
          id: z.id, type: "zone", ...base, zone: z.name, zoneNumber: z.n ?? null, layer: layer ? layer[1] : null,
          w: z.w, h: z.h, aspect: aspect(z.w, z.h), at: z.at ?? [], atFrom: z.atFrom ?? null,
          fps: z.stillOnly ? null : fpsOf(z.id), stillOnly: !!z.stillOnly, ...delivery,
          duration: z.duration ?? delivery.duration, pad: z.pad ?? null, safeInset: insetFor(z.id), guidePage: z.page ?? null,
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
      safeInset: "px title-safe inset copied from the canvas that targets this board, or null when none is recorded",
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
  const head = ["id", "type", "venue", "display", "zone", "layer", "w", "h", "aspect", "at (x,y)", "fps", "still only", "video", "still", "duration", "pad", "safe inset", "canvas keys", "issues", "url"];
  const rows = index.boards.map((b) => [
    b.id, b.type, b.venueName, b.display, b.zone, b.layer, b.w, b.h, b.aspect,
    b.at.map((p) => `${p.x},${p.y}`).join(" | "), b.fps, b.stillOnly ? "yes" : "", b.video, b.still, b.duration, b.pad, b.safeInset,
    b.canvasKeys.join(" "), b.issues.map((i) => `${i.kind}: ${i.text}`).join(" / "), b.url,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const fmt = (b) => `${b.w}x${b.h}`;

// One venue's displays as llms.txt and the design guides print them: heading,
// spec line, layouts and the zone table. With notes, each display also lists
// its own and its zones' manifest notes (speaker scrims, safe areas, audio).
function renderDisplays(v, index, L, { notes }) {
  for (const d of v.displays) {
    const rec = index.boards.find((b) => b.id === d.id);
    const spec = [rec.fps ? `${rec.fps} fps` : null, rec.video, rec.duration, rec.safeInset ? `${rec.safeInset} px title safe` : null].filter(Boolean).join(" · ");
    L.push(`### ${d.name}: ${fmt(d)}${d.processor ? ` (${d.processor})` : ""}`, "");
    L.push(`id \`${d.id}\` · ${rec.aspect}${spec ? ` · ${spec}` : ""}${rec.canvasKeys.length ? ` · keys ${rec.canvasKeys.map((k) => `\`${k}\``).join(", ")}` : ""}`);
    for (const i of d.issues ?? []) L.push(`- ⚠ ${i.kind}: ${i.text}`);
    L.push("");
    if (d.layouts?.length) {
      L.push(`Layouts${d.layouts.some((l) => l.draft) ? " (draft: inferred from geometry, not yet confirmed)" : ""}:`);
      for (const l of d.layouts) L.push(`- ${l.name} (\`${l.id}\`): ${l.zones.map((id) => `\`${id.slice(d.id.length + 1)}\``).join(", ")}`);
      L.push("");
    }
    if (d.zones.length) {
      L.push("| zone id | size | at (x,y) | fps | keys |", "|---|---|---|---|---|");
      for (const z of d.zones) {
        const zr = index.boards.find((b) => b.id === z.id);
        const tags = [zr.stillOnly ? "stills" : zr.fps ? String(zr.fps) : "", zr.safeInset ? `safe ${zr.safeInset}` : "", zr.pad ? `pad ${zr.pad}` : "", z.issues ? `⚠ ${z.issues.map((i) => i.kind).join(", ")}` : ""].filter(Boolean).join(" · ");
        L.push(`| \`${z.id.slice(d.id.length + 1)}\` | ${fmt(z)} | ${zr.at.map((p) => `${p.x},${p.y}`).join(" ") || "–"} | ${tags || "–"} | ${zr.canvasKeys.join(" ") || "–"} |`);
      }
      L.push("");
    }
    if (notes) renderNotes(d, L);
  }
}

function renderNotes(d, L) {
  const lines = (d.notes ?? []).map((n) => `- ${n}`);
  // FG/BG pairs repeat the same note; print it once, against the pair.
  const seen = new Set();
  for (const z of d.zones) {
    const zone = z.id.slice(d.id.length + 1).replace(/-(fg|bg)$/, "-fg/bg");
    for (const n of z.notes ?? []) {
      const pair = /-(fg|bg)$/.test(z.id) && d.zones.some((o) => o !== z && o.id.replace(/-(fg|bg)$/, "") === z.id.replace(/-(fg|bg)$/, ""));
      const line = `- \`${pair ? zone : z.id.slice(d.id.length + 1)}\`: ${n}`;
      if (!seen.has(line)) lines.push(line);
      seen.add(line);
    }
  }
  if (lines.length) L.push("Manifest notes:", ...lines, "");
}

/* ---------------- design guides ---------------- */

// Guidance never carries a size of its own. It names boards with tokens that
// this script expands from the manifest, so a size change reaches every guide:
//   {{camp-randall/north-board/gip}}  full id (a display or a zone)
//   {{north-board/gip}}               id relative to the guide's venue
//   {{MAIN_VIDEO}}                    a canvas key
// Each expands to `id` (w×h at x,y). A token that names nothing is an error.
const TOKEN = /\{\{\s*([^}\s]+)\s*\}\}/g;

function boardRef(index, venueId, token) {
  const canvas = index.canvases.find((c) => c.key === token);
  const id = canvas ? canvas.zoneId ?? canvas.displayId : token;
  const rec = index.boards.find((b) => b.id === id) ?? (venueId ? index.boards.find((b) => b.id === `${venueId}/${id}`) : null);
  if (!rec) return null;
  const at = rec.type === "zone" && rec.at.length ? ` at ${rec.at.map((p) => `${p.x},${p.y}`).join(" / ")}` : "";
  const warn = rec.issues.length ? `, ⚠ ${[...new Set(rec.issues.map((i) => i.kind))].join(", ")}` : "";
  return `\`${rec.id}\` (${rec.w}×${rec.h}${at}${warn})`;
}

// Literal sizes belong in boards.json. This catches "3096x1440" and "1920 × 1080";
// write a token, or move the fact into the manifest as a zone or note. Code
// spans are skipped: they quote names (`PlayerID - LaBahn - Main 1920x1080`).
const LITERAL_SIZE = /\b\d{2,5}\s*[x×]\s*\d{2,5}\b/;

export function checkGuides(manifest, guides) {
  const index = buildIndex(manifest, "");
  const problems = [];
  for (const [name, text] of Object.entries(guides)) {
    const shared = name === SHARED_GUIDE;
    if (!shared && !manifest.venues.some((v) => v.id === name)) problems.push(`${GUIDE_DIR}/${name}.md: no venue ${name} in the manifest`);
    text.split("\n").forEach((line, i) => {
      const at = `${GUIDE_DIR}/${name}.md:${i + 1}`;
      // The shared guide is printed into every venue's file, so it takes full ids only.
      for (const [, t] of line.matchAll(TOKEN)) if (!boardRef(index, shared ? "" : name, t)) problems.push(`${at}: {{${t}}} names no board, zone or canvas key`);
      const literal = LITERAL_SIZE.exec(line.replace(TOKEN, "").replace(/`[^`]*`/g, ""));
      if (literal) problems.push(`${at}: literal size "${literal[0]}"; use a {{board}} token or put the size in boards.json`);
    });
  }
  return problems;
}

export function readGuides(manifest) {
  const guides = {};
  for (const name of [SHARED_GUIDE, ...manifest.venues.map((v) => v.id)]) {
    const path = `${GUIDE_DIR}/${name}.md`;
    if (existsSync(path)) guides[name] = readFileSync(path, "utf8");
  }
  return guides;
}

export const designPath = (venueId) => `${DESIGN_DIR}/${venueId}.md`;

// Guides are written with ## sections; inside the design file they sit one level down.
const demote = (md) => md.replace(/^(#{1,5}) /gm, "#$1 ");

export function renderDesign(manifest, index, v, guides) {
  const expand = (text, venueId) => demote(text.replace(TOKEN, (m, t) => boardRef(index, venueId, t) ?? m).trim());
  const L = [
    `# ${v.name} design guide`,
    "",
    `> How we build content for every board at ${v.name}. Sizes, frame rates and zones come from the Wisconsin board manifest ${manifest.version} (updated ${manifest.updated}); the build guidance is ours.`,
    "",
    `GENERATED by \`scripts/build-board-sizes.mjs\` from \`public/board-sizes/boards.json\`, \`${GUIDE_DIR}/${v.id}.md\` and \`${GUIDE_DIR}/${SHARED_GUIDE}.md\` in the Wisconsin Creative repo. Edit those, never this file. Sizes change only in boards.json.`,
    "",
    "## Read this first",
    "",
    "1. Take every size, position and frame rate from the Boards section below (or from `index.json` by id), never from an old project, a screenshot or memory.",
    `2. Refer to boards by id (e.g. \`${v.displays[0].id}\`) or canvas key, and say which manifest version you used (${manifest.version}).`,
    "3. Check the open issues on every board you touch and tell the person you are working for.",
    `4. Then read Building for ${v.name} and Rules for every venue before you build.`,
    "",
    `## Open issues at ${v.name}`,
    "",
  ];
  const open = v.displays.flatMap((d) => [
    ...(d.issues ?? []).map((i) => [d.id, i]),
    ...d.zones.flatMap((z) => (z.issues ?? []).map((i) => [z.id, i])),
  ]);
  for (const [id, i] of open) L.push(`- \`${id}\` (${i.kind}${i.field ? `, ${i.field}` : ""}): ${i.text}`);
  if (!open.length) L.push("None in this manifest.");
  L.push("", `## Boards (manifest ${manifest.version})`, "");
  for (const n of v.notes ?? []) L.push(`- ${n}`);
  if (v.notes?.length) L.push("");
  renderDisplays(v, index, L, { notes: true });
  L.push(`## Building for ${v.name}`, "", guides[v.id] ? expand(guides[v.id], v.id) : `No ${v.name} guidance yet. Add it to \`${GUIDE_DIR}/${v.id}.md\`.`, "");
  if (guides[SHARED_GUIDE]) L.push("## Rules for every venue", "", expand(guides[SHARED_GUIDE], ""), "");
  return L.join("\n");
}

export function renderLlms(manifest, index) {
  const L = [];
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
    "7. To change a size, edit `public/board-sizes/boards.json` in the Wisconsin Creative repo and run `node scripts/build-board-sizes.mjs`. Never edit the generated files. `node scripts/build-board-sizes.mjs --check` fails when a generated file has drifted.",
    "8. `pad` is a zone inset in px. `safeInset` is a title-safe inset copied from the canvas that targets that board, or null when none is recorded. Crop, scrim, and seam overlays stay on the display in boards.json. Do not invent a safe area when those are absent.",
    "",
    "## Files",
    "",
    `- [index.json](${SITE}/index.json): start here. One flat record per display and zone (${index.boards.length}), with id, size, aspect, positions, fps, delivery, pad, safeInset (or null), canvas keys, issues and a deep link. Also canvases and content types resolved to ids.`,
    "",
    "The page's Copy spec button copies size, aspect ratio, and the safe area that is actually recorded (zone pad, canvas safeInset, crop and scrim overlays). When none is recorded it says `safe area: none recorded`. Guide SVG and Guide PNG download at that board's exact pixel size; they are layout aids, not new measurements.",
    `- [boards.json](${SITE}/boards.json): the hand-edited source (schema \`${manifest.schema}\`). Pin this exact file for production tools; the After Effects Board Builder does.`,
    `- [boards.schema.json](${SITE}/boards.schema.json): JSON Schema for boards.json.`,
    `- [boards.csv](${SITE}/boards.csv): index.json as a spreadsheet.`,
    `- Design guides, one per venue: ${manifest.venues.map((v) => `[${v.name}](${SITE}/design/${v.id}.md)`).join(", ")}. Read the venue's guide before building for it: its boards from this manifest plus how we build them (GIP and scrim coverage, kickouts, seams, deliverable splits, naming, motion and type rules).`,
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
    renderDisplays(v, index, L, { notes: false });
  }
  L.push("## Changes", "");
  for (const c of manifest.changes) L.push(`- ${c.version}: ${c.summary}`);
  L.push("");
  return L.join("\n");
}

export function renderAll(manifestBytes, guides = readGuides(JSON.parse(manifestBytes))) {
  const manifest = JSON.parse(manifestBytes);
  const index = buildIndex(manifest, manifestBytes);
  return {
    [DATA_PATH]: renderDataJs(manifest),
    [INDEX_PATH]: renderIndexJson(index),
    [CSV_PATH]: renderCsv(index),
    [LLMS_PATH]: renderLlms(manifest, index),
    ...Object.fromEntries(manifest.venues.map((v) => [designPath(v.id), renderDesign(manifest, index, v, guides)])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const bytes = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(bytes);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const schemaProblems = validateSchema(manifest, schema);
  const problems = validateManifest(manifest);
  if (schemaProblems.length || problems.length) {
    console.error(`${MANIFEST_PATH} is invalid:\n  ${[...schemaProblems, ...problems].join("\n  ")}`);
    process.exit(1);
  }
  const guideProblems = checkGuides(manifest, readGuides(manifest));
  if (guideProblems.length) {
    console.error(`design guidance needs fixing:\n  ${guideProblems.join("\n  ")}`);
    process.exit(1);
  }
  const outputs = renderAll(bytes);
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const stale = Object.keys(outputs).filter((p) => read(p) !== outputs[p]);
  if (check) {
    for (const p of stale) console.error(`${p} is stale: run node scripts/build-board-sizes.mjs`);
    if (stale.length) process.exit(1);
    const page = readFileSync(PAGE_PATH, "utf8");
    if (stampPage(PAGE_PATH) !== page) {
      console.error(`${PAGE_PATH} script hashes are stale: run node scripts/build-board-sizes.mjs`);
      process.exit(1);
    }
    process.exit(0);
  }
  for (const p of stale) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, outputs[p]); }
  const page = readFileSync(PAGE_PATH, "utf8");
  const stamped = stampPage(PAGE_PATH);
  if (stamped !== page) writeFileSync(PAGE_PATH, stamped);
  for (const p of Object.keys(outputs)) console.log(`${stale.includes(p) ? "wrote    " : "unchanged"} ${p}`);
  console.log(`manifest ${manifest.version}: ${manifest.canvases.length} canvases`);
}
