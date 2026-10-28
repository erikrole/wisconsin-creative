#!/usr/bin/env node
// Per-route first-load JavaScript (gzipped) from a finished `npm run build:app`.
// A route's first load is the framework chunks plus every chunk its layouts and page reference.
// Usage: node scripts/measure-bundle.mjs [buildDir=.next/build] [topN=15]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";

const buildDir = process.argv[2] ?? ".next/build";
const topN = Number(process.argv[3] ?? 15);
const appDir = join(buildDir, "server/app");
const gzipSizes = new Map();
const gzipKb = (file) => {
  if (!gzipSizes.has(file)) {
    const path = join(buildDir, file);
    gzipSizes.set(file, existsSync(path) ? gzipSync(readFileSync(path)).length : 0);
  }
  return gzipSizes.get(file);
};

const framework = JSON.parse(readFileSync(join(buildDir, "build-manifest.json"), "utf8")).rootMainFiles.filter((file) => file.endsWith(".js"));
const routes = [];

function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name === "page_client-reference-manifest.js") {
      const globals = { __RSC_MANIFEST: {} };
      runInNewContext(readFileSync(path, "utf8"), { globalThis: globals });
      const [manifest] = Object.values(globals.__RSC_MANIFEST);
      const folder = relative(appDir, dir);
      const files = new Set(framework);
      for (const [key, chunks] of Object.entries(manifest.entryJSFiles)) {
        const segment = key.replace("[project]/src/app/", "").replace(/\/?(page|layout|loading|template)$/, "");
        const isPage = key.endsWith("/page");
        if (!/\/(page|layout|loading|template)$/.test(key)) continue;
        if (isPage ? segment !== folder : segment !== "" && !folder.startsWith(segment)) continue;
        for (const chunk of chunks) files.add(chunk);
      }
      let total = 0;
      for (const file of files) total += gzipKb(file);
      routes.push({ route: `/${folder.replace(/\([^)]*\)\/?/g, "")}`, kb: total / 1024 });
    }
  }
}
visit(appDir);

routes.sort((a, b) => b.kb - a.kb);
const median = routes.map((r) => r.kb).sort((a, b) => a - b)[Math.floor(routes.length / 2)];
console.log(`${routes.length} routes, median first-load JS ${median.toFixed(0)} KB gzip, largest ${routes[0].kb.toFixed(0)} KB`);
for (const { route, kb } of routes.slice(0, topN)) console.log(`${kb.toFixed(0).padStart(5)} KB  ${route}`);
