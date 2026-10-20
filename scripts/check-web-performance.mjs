/** Real Chromium regression for provider identity, shared reads and paused polling.
 * Uses the actual components against deterministic API fixtures, never production.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const output = resolve(".tmp/performance");
await mkdir(output, { recursive: true });
const bundle = await build({
  entryPoints: ["tests/performance/browser-fixture.tsx"],
  bundle: true, write: false, platform: "browser", format: "iife",
  jsx: "automatic", alias: { "@": resolve("src") },
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
});
const server = createServer((req, res) => {
  res.setHeader("content-type", req.url === "/fixture.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/fixture.js" ? bundle.outputFiles[0].contents : '<div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PERFORMANCE_BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage();
  // Keep async rendering/network delivery real; only Date is fixed until mount.
  await page.clock.setFixedTime(new Date("2026-10-20T16:00:00Z"));
  const calls = { stats: 0, bookings: 0, items: 0 };
  const errors = [];
  const holdNext = new Set();
  const pending = new Map();
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === "/api/dashboard/stats") {
      calls.stats++;
      data = { data: { myOverdueCount: 3, myDueTodayCount: 1 }, partialFailures: [] };
    } else if (path === "/api/bookings/changes") {
      calls.bookings++;
      data = { data: { cursor: "fixture", changedBookingIds: [] } };
    } else if (path === "/api/items/changes") {
      calls.items++;
      data = { data: { cursor: "fixture", changedAssetIds: [], changedBulkSkuIds: [] } };
    } else throw new Error(`Unexpected fixture request: ${path}`);
    if (holdNext.delete(path)) {
      await new Promise((release) => { pending.set(path, release); });
    }
    await route.fulfill({ json: data });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="home"]')?.textContent === "3");
  await page.getByRole("textbox", { name: "Draft" }).fill("Keep my unfinished work");
  assert.equal(await page.getByTestId("navigation").textContent(), "3");
  assert.equal(calls.stats, 1, "Home and navigation must share the same stats request");
  assert.deepEqual(await page.evaluate(() => window.performanceProbe), { mounts: 1, unmounts: 0, scheduleRefreshes: 0 });
  await expect.poll(() => calls.bookings).toBeGreaterThan(0);
  await expect.poll(() => calls.items).toBeGreaterThan(0);
  await page.clock.install({ time: new Date("2026-10-20T16:00:00Z") });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Let React commit the visibility transition before advancing browser timers.
  await page.clock.runFor(20);
  const paused = { ...calls };
  await page.clock.runFor(180_000);
  assert.deepEqual(calls, paused, "Hidden surfaces must perform zero scheduled reads");
  assert.equal(await page.evaluate(() => window.performanceProbe.scheduleRefreshes), 0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1);
  await page.waitForFunction(() => document.querySelector('[data-testid="home"]')?.textContent === "3");
  // Poll Node-side request counters so already-completed responses cannot be missed.
  await expect.poll(() => calls.bookings).toBeGreaterThan(paused.bookings);
  await expect.poll(() => calls.items).toBeGreaterThan(paused.items);
  assert.ok(calls.bookings > paused.bookings, "Booking freshness resumes on return");
  assert.ok(calls.items > paused.items, "Inventory freshness resumes on return");
  await page.clock.runFor(15_050);
  await expect.poll(() => page.evaluate(() => window.performanceProbe.scheduleRefreshes)).toBe(1);
  await page.clock.runFor(1_000);
  assert.equal(await page.evaluate(() => window.performanceProbe.scheduleRefreshes), 1, "A parent loading state must not trigger an immediate refresh/remount loop");
  // Hold the old requests while a hide/show cycle starts replacement effects.
  // An old in-flight flag must not starve the replacement's immediate read.
  holdNext.add("/api/bookings/changes");
  holdNext.add("/api/items/changes");
  await page.clock.runFor(60_000);
  await expect.poll(() => pending.size).toBe(2);
  const beforeReplacement = { ...calls };
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(20);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(20);
  await expect.poll(() => calls.bookings).toBeGreaterThan(beforeReplacement.bookings);
  await expect.poll(() => calls.items).toBeGreaterThan(beforeReplacement.items);
  for (const release of pending.values()) release();
  pending.clear();
  assert.equal(await page.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep my unfinished work");
  assert.deepEqual(errors, []);
  const result = { provider: await page.evaluate(() => window.performanceProbe), calls, hiddenScheduledReads: 0, inFlightResumePassed: true, preservedDraft: true, errors };
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
