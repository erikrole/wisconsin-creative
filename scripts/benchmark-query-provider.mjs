#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// A real-browser lifecycle regression and repeatable fixture benchmark of the
// production provider. No Next auth bypass, credentials, or external requests.
const verify = process.argv.includes("--verify");
const output = process.argv.find((value, index) => index > 1 && !value.startsWith("--"));
const temporary = await mkdtemp(join(tmpdir(), "wc-query-benchmark-"));
const component = `
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryProvider, useAuthenticatedQueryUserId } from "@/components/QueryProvider";
function Probe() {
  const [count, setCount] = useState(0);
  const userId = useAuthenticatedQueryUserId();
  const result = useQuery({ queryKey: ["dashboard", userId], queryFn: async ({ signal }) => {
    window.measurements.queryCalls++;
    return (await fetch("/query", { signal })).json();
  }});
  useEffect(() => {
    const stats = window.measurements;
    stats.mounts++;
    const controller = new AbortController();
    stats.requests++;
    fetch("/work", { signal: controller.signal }).then(r => r.json()).then(() => stats.completed++)
      .catch(error => { if (error.name === "AbortError") stats.cancelled++; else stats.errors.push(error.message); });
    return () => { stats.unmounts++; controller.abort(); };
  }, []);
  return <main><h1>Provider benchmark</h1><p id="data">{result.data?.label ?? "Loading"}</p>
    <button onClick={() => setCount(count + 1)}>Count {count}</button></main>;
}
export function App() { return <QueryProvider userId="benchmark-user"><Probe /></QueryProvider>; }
`;
const options = { bundle: true, alias: { "@": resolve("src") }, logLevel: "silent", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } };
let browser, server;
try {
  const serverEntry = join(temporary, "ssr.cjs");
  await build({ ...options, stdin: { contents: component + '\nimport { renderToString } from "react-dom/server"; export function render() { return renderToString(<App />); }', loader: "tsx", resolveDir: process.cwd() }, platform: "node", format: "cjs", outfile: serverEntry });
  const html = createRequire(import.meta.url)(serverEntry).render();
  const { outputFiles } = await build({ ...options, stdin: { contents: component + `
import { hydrateRoot } from "react-dom/client";
import { QueryClient, dehydrate } from "@tanstack/react-query";
const scenario = new URL(location.href).searchParams.get("scenario");
window.measurements = { mounts: 0, unmounts: 0, requests: 0, completed: 0, cancelled: 0, queryCalls: 0, errors: [] };
if (scenario === "warm") {
  const seed = new QueryClient(); seed.setQueryData(["dashboard", "benchmark-user"], { label: "Cached dashboard" });
  localStorage.setItem("gear-tracker:query-cache", JSON.stringify({ buster: "", timestamp: Date.now(), clientState: dehydrate(seed) }));
} else if (scenario === "corrupt") { localStorage.setItem("gear-tracker:query-cache", "invalid-json"); }
if (scenario === "blocked-storage") { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage is disabled", "SecurityError"); } }); }
hydrateRoot(document.getElementById("root"), <App />, { onUncaughtError: error => window.measurements.errors.push(error.message), onRecoverableError: error => window.measurements.errors.push(error.message) });
`, loader: "tsx", resolveDir: process.cwd() }, platform: "browser", format: "iife", minify: true, write: false });
  server = createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(outputFiles[0].contents); return; }
    if (["/query", "/work"].includes(request.url)) {
      setTimeout(() => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ label: "Network dashboard" })); }, 100);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><body><div id="root">${html}</div><script src="/app.js"></script></body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true });
  const samples = [];
  for (const scenario of ["cold", "warm", "corrupt", "blocked-storage"]) {
    for (let iteration = 1; iteration <= 5; iteration++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=${scenario}`);
      await page.waitForFunction(() => window.measurements?.errors.length || (window.measurements?.completed > 0 && document.getElementById("data")?.textContent !== "Loading"));
      const sample = { scenario, iteration, ...await page.evaluate(() => ({ ...window.measurements, label: document.getElementById("data")?.textContent })) };
      samples.push(sample);
      if (verify) {
        assert.deepEqual(sample.errors, [], `${scenario}: no hydration/storage failures`);
        assert.equal(sample.mounts, 1, `${scenario}: mount the page once`);
        assert.equal(sample.unmounts, 0, `${scenario}: preserve the mounted page`);
        assert.equal(sample.requests, 1, `${scenario}: no repeated effect request`);
        assert.equal(sample.cancelled, 0, `${scenario}: no abandoned initial request`);
        assert.equal(sample.queryCalls, scenario === "warm" ? 0 : 1, `${scenario}: restore before fetching`);
        assert.equal(sample.label, scenario === "warm" ? "Cached dashboard" : "Network dashboard");
        await page.getByRole("button", { name: "Count 0" }).click();
        assert.equal(await page.getByRole("button").textContent(), "Count 1");
      }
      await context.close();
    }
  }
  const report = { recordedAt: new Date().toISOString(), mode: "Production React; SSR hydration; real QueryProvider; synthetic 100 ms loopback responses; five isolated browser contexts per scenario", verified: verify, samples };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.table(samples.filter((sample) => sample.iteration === 1).map(({ errors, ...sample }) => ({ ...sample, errors: errors.join("; ") })));
} finally {
  await browser?.close();
  await new Promise((done) => server ? server.close(done) : done());
  await rm(temporary, { recursive: true, force: true });
}
