#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { availablePreviewPort, currentBranch, localPreviewEnvironment, readPreviewState, verifyPreviewState } from "./lib/preview-environment.mjs";
import { localChecksums } from "./lib/local-migrations.mjs";
import { readMigrationRows } from "./lib/migration-baseline.mjs";
import { assertFallbackHistory } from "./prisma-migrate-deploy.mjs";
import { retainPreview } from "./lib/preview-lifecycle.mjs";
import { acquireProcessLock } from "./lib/process-lock.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("node scripts/benchmark-authenticated-preview.mjs [--build | --reuse-build-report FILE] [--samples 5] [--output DIRECTORY]\nUses only the current branch's signed preview. Starts and stops its own local production server.\n--build builds current source with isolated settings; --reuse-build-report verifies a prior report against this build, source, branch and Node version.\nWithout either, build provenance is unverified. Writes non-secret results.json and local screenshots, plus private build/server logs. Never deploys.");
  process.exit(0);
}
let samples = 5, build = false, buildReport, output = `.tmp/preview-benchmarks/${new Date().toISOString().replaceAll(":", "-")}`;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--build") build = true;
  else if (args[i] === "--reuse-build-report" && args[i + 1]) buildReport = resolve(args[++i]);
  else if (args[i] === "--samples" && args[i + 1]) samples = Number(args[++i]);
  else if (args[i] === "--output" && args[i + 1]) output = args[++i];
  else throw new Error(`Unknown or incomplete option: ${args[i]}`);
}
assert(Number.isInteger(samples) && samples >= 3 && samples <= 20, "Use 3–20 samples");
assert(!(build && buildReport), "Choose a fresh build or a verified existing build");
assert.equal(process.versions.node.split(".")[0], "22", "Use the repository's Node 22 runtime");
output = resolve(output);
// Keep private runtime logs out of tracked evidence directories and do not replace a prior run.
assert(output.startsWith(resolve(".tmp") + "/"), "Output must be a new directory under this checkout's .tmp");
assert(!existsSync(output), "Choose a new output directory to preserve previous measurements");

const routes = [
  { path: "/", name: "home", heading: "Dashboard" },
  { path: "/items", name: "items", heading: "Items" },
  { path: "/bookings", name: "bookings", heading: "Bookings" },
  { path: "/schedule", name: "schedule", heading: "Schedule" },
  { path: "/signatures", name: "signatures", heading: "Signatures" },
];
const apiPaths = ["/api/me", "/api/dashboard", "/api/dashboard/stats", "/api/items-page-init", "/api/assets?limit=50", "/api/bookings?limit=50", "/api/calendar-events?limit=100", "/api/signatures/collections"];
const round = (value) => Math.round(value * 100) / 100;
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { samples: sorted.length, median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]), min: round(sorted[0]), max: round(sorted.at(-1)) };
}
function sourceFingerprint() {
  const files = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "src", "prisma/schema.prisma", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json"], { encoding: "utf8" }).split("\0").filter(Boolean))].sort();
  const hash = createHash("sha256");
  for (const file of files) { hash.update(file + "\0"); hash.update(existsSync(file) ? readFileSync(file) : "<deleted>"); hash.update("\0"); }
  return hash.digest("hex");
}

const lease = acquireProcessLock(resolve(".tmp/preview-benchmark.lock"));
let child, browser, serverLog, report, activeState;
const abort = new AbortController();
const stop = () => { abort.abort(); child?.kill("SIGTERM"); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  const state = readPreviewState(), checksums = localChecksums();
  activeState = state;
  const { sql, baseline } = await verifyPreviewState(state, checksums);
  assert.deepEqual(assertFallbackHistory(checksums, await readMigrationRows(sql), baseline), [], "Run dev:preview or preview:migrate before benchmarking");
  await retainPreview(sql);
  const port = await availablePreviewPort(), environment = localPreviewEnvironment(state, port), origin = environment.APP_URL;
  const sourceHash = sourceFingerprint();
  mkdirSync(output, { recursive: true, mode: 0o700 });
  serverLog = openSync(join(output, "server.log"), "wx", 0o600);
  const launch = (mode, extra = [], log = serverLog) => {
    child = spawn(process.execPath, ["scripts/run-next.mjs", mode, ...extra], { env: environment, stdio: ["ignore", log, log] });
    lease.registerChild(child.pid);
    child.on("error", () => abort.abort());
    return child;
  };
  if (build) {
    console.log("Building current source with the isolated preview settings...");
    const log = openSync(join(output, "build.log"), "wx", 0o600);
    try {
      const [code] = await once(launch("build:app", [], log), "exit");
      assert.equal(code, 0, "App build failed; inspect the private build.log");
    } finally { closeSync(log); }
  }
  const buildId = readFileSync(".next/build/BUILD_ID", "utf8").trim();
  let buildProvenance = build ? { kind: "built-during-run" } : { kind: "unverified-existing-build" };
  if (buildReport) {
    const raw = readFileSync(buildReport), prior = JSON.parse(raw);
    assert(prior.builtCurrentSource === true && prior.buildId === buildId && prior.sourceHash === sourceHash && prior.branchId === state.branchId && prior.node === process.version, "Prior report does not prove this source, build, preview and runtime combination");
    buildProvenance = { kind: "reused-verified-build", reportSha256: createHash("sha256").update(raw).digest("hex") };
  }
  launch("start", ["--hostname", "127.0.0.1", "--port", String(port)]);
  let ready = false;
  for (let attempt = 0; attempt < 90 && !abort.signal.aborted; attempt++) {
    if (child.exitCode !== null) throw new Error("Production server exited; inspect the private server.log");
    try { const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) }); ready = response.ok; await response.arrayBuffer(); } catch { /* bounded startup probe */ }
    if (ready) break;
    await delay(500, undefined, { signal: abort.signal });
  }
  assert(ready, "Production server did not become ready");
  browser = await chromium.launch({ headless: true });
  const options = { viewport: { width: 1440, height: 1000 }, colorScheme: "light", locale: "en-US", timezoneId: "America/Chicago", reducedMotion: "reduce" };
  const authenticated = await browser.newContext(options), signIn = await authenticated.newPage();
  await signIn.goto(`${origin}/login`);
  await signIn.getByLabel("Email").fill(environment.PLAYWRIGHT_EMAIL);
  await signIn.getByRole("button", { name: "Continue", exact: true }).click();
  await signIn.getByLabel("Password", { exact: true }).fill(environment.PLAYWRIGHT_PASSWORD);
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await signIn.waitForURL(origin + "/");
  await signIn.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  const storage = await authenticated.storageState();
  // Preserve only the signed-in cookie; each cold sample starts with empty browser storage/cache.
  const authState = { cookies: storage.cookies, origins: [] };
  report = { status: "running", recordedAt: new Date().toISOString(), gitBranch: state.gitBranch, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceHash, runnerHash: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), builtCurrentSource: build || Boolean(buildReport), buildProvenance, buildId, node: process.version, browser: browser.version(), environment: "Local production-mode Next server, signed isolated Neon child, synthetic ADMIN; no CPU/network throttling", branchId: state.branchId, samples, definitions: { cold: "Fresh browser context and empty cache; server/database already awake", warm: "Reload in the same context with retained HTTP cache and persisted queries", headingVisibleMs: "Navigation start to accessible route heading; does not assert every content row is ready", readsSettledMs: "Navigation start to document load and 500ms without outstanding GET/HEAD requests; includes observation delay. Background POST completion is reported separately and never intercepted", apiMs: "Browser-authenticated GET through full JSON body over loopback plus remote preview database; one discarded warmup per endpoint", p95: "Nearest-rank estimate; small sample counts do not establish production tail latency" }, authenticatedViaLoginUi: true, routes: [], api: [], errors: [] };
  const saveReport = () => writeFileSync(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  async function capture(page, route, mode, iteration, navigate) {
    const errors = [], responses = [], failed = [], requests = [], active = new Map();
    const start = performance.now();
    const isRead = request => ["GET", "HEAD"].includes(request.method());
    let lastReadActivity = start;
    const onRequest = request => { const url = new URL(request.url()); const entry = { host: url.host, path: url.pathname + url.search, method: request.method(), type: request.resourceType(), startedAtMs: round(performance.now() - start) }; requests.push(entry); active.set(request, entry); if (isRead(request)) lastReadActivity = performance.now(); };
    const onFinished = request => { const entry = active.get(request); if (entry) entry.finishedAtMs = round(performance.now() - start); active.delete(request); if (isRead(request)) lastReadActivity = performance.now(); };
    const onError = error => errors.push(error.message);
    const onResponse = response => { const url = new URL(response.url()); const entry = active.get(response.request()); if (entry) { entry.responseAtMs = round(performance.now() - start); entry.status = response.status(); } if (url.origin === origin && url.pathname.startsWith("/api/")) responses.push({ path: url.pathname + url.search, status: response.status() }); };
    const onFailed = request => failed.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
    page.on("pageerror", onError); page.on("response", onResponse); page.on("requestfailed", onFailed); page.on("request", onRequest); page.on("requestfinished", onFinished); page.on("requestfailed", onFinished);
    await navigate();
    assert.equal(new URL(page.url()).pathname, route.path, "Route redirected unexpectedly");
    await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({ timeout: 30000 });
    const headingVisibleMs = round(performance.now() - start);
    try {
      await page.waitForLoadState("load", { timeout: 30000 });
      const deadline = performance.now() + 30000;
      while ([...active.keys()].some(isRead) || performance.now() - lastReadActivity < 500) {
        assert(performance.now() < deadline, "Read requests did not settle within 30 seconds");
        await delay(50, undefined, { signal: abort.signal });
      }
    }
    catch (error) {
      writeFileSync(join(output, "network-timeout.json"), JSON.stringify({ route: route.path, mode, requests, pending: [...active.values()], responses, failed, errors }, null, 2), { mode: 0o600 });
      await page.screenshot({ path: join(output, "network-timeout.png"), animations: "disabled" });
      throw error;
    }
    const readsSettledMs = round(performance.now() - start);
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      return { ttfbMs: navigation.responseStart, domContentLoadedMs: navigation.domContentLoadedEventEnd, transferredBytes: navigation.transferSize + resources.reduce((sum, item) => sum + item.transferSize, 0), resourceRequests: resources.length, horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    if (iteration === 0 && mode !== "warm") await page.screenshot({ path: join(output, `${route.name}-${mode}.png`), animations: "disabled" });
    page.off("pageerror", onError); page.off("response", onResponse); page.off("requestfailed", onFailed); page.off("request", onRequest); page.off("requestfinished", onFinished); page.off("requestfailed", onFinished);
    const result = { mode, iteration, headingVisibleMs, readsSettledMs, ...metrics, apiResponses: responses, requests, pendingBackgroundRequests: [...active.values()], failedRequests: failed, errors };
    if (errors.length || responses.some(r => r.status >= 400) || metrics.horizontalOverflow > 1) report.errors.push({ route: route.path, mode, iteration, errors, apiFailures: responses.filter(r => r.status >= 400), horizontalOverflow: metrics.horizontalOverflow });
    return result;
  }
  for (const route of routes) {
    abort.signal.throwIfAborted();
    assert.equal(currentBranch(), state.gitBranch, "Git branch changed during benchmark");
    const raw = [];
    for (let iteration = 0; iteration < samples; iteration++) {
      const context = await browser.newContext({ ...options, storageState: authState }), page = await context.newPage();
      raw.push(await capture(page, route, "cold", iteration, () => page.goto(origin + route.path, { waitUntil: "commit" })));
      raw.push(await capture(page, route, "warm", iteration, () => page.reload({ waitUntil: "commit" })));
      await context.close();
    }
    const mobile = await browser.newContext({ ...options, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: authState }), page = await mobile.newPage();
    raw.push(await capture(page, route, "narrow-mobile", 0, () => page.goto(origin + route.path, { waitUntil: "commit" })));
    await mobile.close();
    const summary = Object.fromEntries(["cold", "warm"].map(mode => [mode, Object.fromEntries(["headingVisibleMs", "readsSettledMs", "ttfbMs", "transferredBytes"].map(metric => [metric, summarize(raw.filter(r => r.mode === mode).map(r => r[metric]))]))]));
    report.routes.push({ path: route.path, summary, raw });
    saveReport();
    console.log(JSON.stringify({ route: route.path, coldHeadingMedianMs: summary.cold.headingVisibleMs.median, warmHeadingMedianMs: summary.warm.headingVisibleMs.median }));
  }
  for (const path of apiPaths) {
    const raw = [];
    for (let iteration = -1; iteration < samples; iteration++) {
      abort.signal.throwIfAborted();
      // Chromium accepts secure cookies on loopback. Its separate APIRequestContext
      // does not share that exception, so measure with the actual signed-in page.
      const result = await signIn.evaluate(async path => {
        const start = performance.now();
        const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
        const body = await response.arrayBuffer(), ms = performance.now() - start;
        const json = JSON.parse(new TextDecoder().decode(body)), data = json.data ?? json.collections;
        return { ms, status: response.status, bytes: body.byteLength, returnedRows: Array.isArray(data) ? data.length : null, partialFailures: json.partialFailures ?? [] };
      }, path);
      assert(result.status >= 200 && result.status < 300, `Authenticated read failed: ${path} (${result.status})`);
      assert.deepEqual(result.partialFailures, [], `Partial data returned by ${path}`);
      if (iteration >= 0) raw.push({ ...result, ms: round(result.ms) });
    }
    report.api.push({ path, ms: summarize(raw.map(r => r.ms)), raw });
    saveReport();
  }
  const [dataset] = await sql.query("SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM assets) AS assets, (SELECT count(*)::int FROM bookings) AS bookings, (SELECT count(*)::int FROM calendar_events) AS calendar_events");
  report.dataset = dataset;
  report.sourceUnchangedDuringRun = sourceFingerprint() === sourceHash && currentBranch() === state.gitBranch;
  assert(report.sourceUnchangedDuringRun, "Source changed during benchmark; repeat with stable source");
  report.status = report.errors.length ? "failed" : "complete";
  saveReport();
  console.log(JSON.stringify({ output, routes: report.routes.length, apiEndpoints: report.api.length, runtimeFailures: report.errors.length, dataset, currentSourceBuildVerified: report.builtCurrentSource }));
  if (report.errors.length) process.exitCode = 1;
} catch (error) {
  let message = String(error?.message ?? error);
  for (const value of Object.values(activeState?.environment ?? {})) {
    if (typeof value === "string" && value.length > 12) message = message.replaceAll(value, "[private preview value]");
  }
  message = message.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[private connection]").replace(/vercel_blob_rw_[^\s"']+/g, "[private storage token]");
  if (report) { report.status = "failed"; report.failure = message; writeFileSync(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); }
  console.error(message); process.exitCode = 1;
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit"); child.kill("SIGTERM");
    await Promise.race([exited, delay(10000, undefined, { ref: false })]);
  }
  lease.registerChild(null); lease();
  if (serverLog !== undefined) closeSync(serverLog);
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
}
