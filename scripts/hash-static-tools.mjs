#!/usr/bin/env node
// Stamps each static tool's script URLs with a content hash.
//
// public/sw.js serves .js cache-first, so a script URL must change whenever the
// file does or visitors keep running stale code. Run after editing a tool's
// script: `node scripts/hash-static-tools.mjs`. tests/static-tools.test.ts
// fails when a stamp is out of date.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HASHED_TOOLS = ["public/golden-hour/index.html", "public/timelapse/index.html", "public/board-sizes/index.html"];

export function stamp(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  return html.replace(/<script src="([^"?]+)\?v=[0-9a-f]{12}"><\/script>/g, (_, file) => {
    const hash = createHash("sha256").update(readFileSync(join(dirname(htmlPath), file))).digest("hex").slice(0, 12);
    return `<script src="${file}?v=${hash}"></script>`;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const path of HASHED_TOOLS) {
    const before = readFileSync(path, "utf8");
    const after = stamp(path);
    if (after !== before) writeFileSync(path, after);
    console.log(`${after === before ? "unchanged" : "stamped  "} ${path}`);
  }
}
