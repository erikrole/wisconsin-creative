#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Run after build:app. Count each initial JS chunk once across the route and
// all of its parent layouts; a page-only manifest undercounts shared chrome.
const build = resolve(process.env.WC_BENCHMARK_BUILD_DIR ?? ".next/build");
const { pages } = JSON.parse(readFileSync(resolve(build, "app-build-manifest.json"), "utf8"));
const routes = ["/", "/items", "/bookings", "/schedule", "/reservations/new", "/users", "/resources", "/signatures"];
const results = routes.map((route) => {
  const page = `/(app)${route === "/" ? "" : route}/page`;
  if (!pages[page]) throw new Error(`Missing build manifest entry: ${page}`);
  const owners = Object.keys(pages).filter((key) => key === page || (
    key.endsWith("/layout") && page.startsWith(key.slice(0, -"layout".length))
  ));
  const files = [...new Set(owners.flatMap((key) => pages[key]))].filter((file) => file.endsWith(".js"));
  const chunks = files.map((file) => {
    const data = readFileSync(resolve(build, file));
    return { file, bytes: data.length, gzipBytes: gzipSync(data).length };
  });
  return {
    route, chunks: chunks.length,
    bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    gzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    files: chunks,
  };
});
const report = { recordedAt: new Date().toISOString(), measure: "Initial JS, route plus parent layouts; gzip per unique file; not measured network transfer or latency", routes: results };
const output = process.argv[2];
if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ route, chunks, bytes, gzipBytes }) => ({ route, chunks, bytes, gzipBytes })));
