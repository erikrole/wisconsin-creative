#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join, basename } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// Fixture proof of the real form and its lazy-loading boundary. The optional
// baseline is a saved pre-edit source file, never a checkout reset.
const baselineArg = process.argv.indexOf("--baseline");
const baseline = baselineArg < 0 ? null : resolve(process.argv[baselineArg + 1]);
const outputArg = process.argv.indexOf("--output");
const proof = resolve(outputArg < 0 ? ".tmp/profile-performance" : process.argv[outputArg + 1]);
const temporary = await mkdtemp(join(tmpdir(), "wc-profile-benchmark-"));
let browser, server;
const fixture = {
  profile: { id: "benchmark-user", name: "Fixture Staff", role: "STAFF", email: "fixture@wisc.edu", athleticsEmail: "fixture@athletics.wisc.edu", phone: null, personalPhone: "6085550100", workPhone: null, workPhoneNotApplicable: true, wiscardCardNumber: null, wiscardIssueCode: null, studentYearOverride: null, gradYear: null, graduationTerm: null, topSizeFit: "UNISEX", topSize: "M", shoeSizeSystem: "US_MENS", shoeSize: "10", avatarUrl: null, profilePromptSnoozedUntil: null },
  completion: { operationalReady: true, profileComplete: true, isComplete: true, isSnoozed: false, shouldPrompt: false, snoozedUntil: null, completedCount: 6, totalCount: 6, missingFields: [], firstIncompleteStep: null, completeByField: {} },
};
try {
  await mkdir(proof, { recursive: true });
  const entries = {};
  for (const variant of baseline ? ["before", "after"] : ["after"]) {
    const entry = join(temporary, `${variant}.tsx`);
    const owner = variant === "before" ? baseline : resolve("src/components/profile-completion/ProfileCompletionWizard.tsx");
    await writeFile(entry, `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryProvider } from ${JSON.stringify(resolve("src/components/QueryProvider.tsx"))};
      import { getQueryClient } from ${JSON.stringify(resolve("src/lib/query-client.ts"))};
      import { ProfileCompletionWizard } from ${JSON.stringify(owner)};
      import { openProfileCompletion } from ${JSON.stringify(resolve("src/lib/profile-completion-events.ts"))};
      const scenario = new URL(location.href).searchParams.get("scenario");
      const fixture = ${JSON.stringify(fixture)};
      if (scenario !== "manual") Object.assign(fixture.completion, { isComplete: false, shouldPrompt: true, firstIncompleteStep: "PHONES" });
      window.fixture = fixture;
      getQueryClient().setQueryData(["profile-completion"], fixture);
      createRoot(document.getElementById("root")).render(<QueryProvider userId="benchmark-user">
        <main style={{ padding: 32 }}><h1>Profile setup</h1><button onClick={openProfileCompletion}>Open profile</button></main>
        <ProfileCompletionWizard autoOpen={scenario !== "home"} />
      </QueryProvider>);
    `);
    entries[variant] = entry;
  }
  const bundle = await build({ entryPoints: entries, bundle: true, splitting: true, format: "esm", platform: "browser", outdir: join(temporary, "assets"), metafile: true, minify: true, jsx: "automatic", nodePaths: [resolve("node_modules")], alias: { "@": resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const dialogFiles = Object.entries(bundle.metafile.outputs).filter(([, info]) => Object.keys(info.inputs).some((input) => input.endsWith("/ProfileCompletionDialog.tsx"))).map(([file]) => basename(file));
  const manifest = JSON.parse(await readFile(".next/build/app-build-manifest.json", "utf8"));
  const css = (await Promise.all(manifest.pages["/layout"].filter((file) => file.endsWith(".css")).map((file) => readFile(resolve(".next/build", file), "utf8")))).join("\n");
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (url.pathname.endsWith(".js")) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(await readFile(join(temporary, "assets", basename(url.pathname)))); return;
      }
      if (url.pathname.startsWith("/media/")) {
        response.end(await readFile(resolve(".next/build/static/media", basename(url.pathname)))); return;
      }
      const variant = url.searchParams.get("variant") === "before" ? "before" : "after";
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/${variant}.js"></script></body></html>`);
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const variant of baseline ? ["before", "after"] : ["after"]) {
    for (const scenario of ["manual", "automatic", "home"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", locale: "en-US", timezoneId: "America/Chicago", reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const resources = [];
      page.on("response", (response) => { if (response.url().endsWith(".js")) resources.push(basename(response.url())); });
      await page.clock.setFixedTime(new Date("2026-09-27T16:00:00Z"));
      await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      await page.route("**/api/me/profile-completion", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.step === "SNOOZE") {
          const updated = await page.evaluate(() => ({ ...window.fixture, completion: { ...window.fixture.completion, isSnoozed: true, shouldPrompt: false } }));
          await route.fulfill({ json: { data: updated } });
        } else { await route.fulfill({ status: 500, json: { error: "Fixture save failed" } }); }
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/?variant=${variant}&scenario=${scenario}`);
      await page.waitForLoadState("networkidle");
      const initialScripts = [...resources];
      if (scenario !== "automatic") {
        assert.equal(await page.getByRole("dialog").count(), 0);
        if (variant === "after") assert.equal(initialScripts.some((file) => dialogFiles.includes(file)), false, "Closed form should not load the dialog chunk");
        await page.getByRole("button", { name: "Open profile" }).click();
      }
      const title = scenario === "manual" ? "Confirm your email addresses" : "Add your phone numbers";
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (scenario === "manual") {
        await page.screenshot({ path: join(proof, `profile-${variant}.png`), animations: "disabled" });
        await page.getByLabel("Athletics email", { exact: true }).fill("edited@athletics.wisc.edu");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByText("Fixture save failed", { exact: true }).waitFor();
        assert.equal(await page.getByLabel("Athletics email", { exact: true }).inputValue(), "edited@athletics.wisc.edu", "Failed saves retain entered data");
        await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
        await page.screenshot({ path: join(proof, `profile-error-${variant}.png`), animations: "disabled" });
      }
      await page.getByRole("button", { name: "Remind me tomorrow" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Open profile" }).click();
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.deepEqual(errors, []);
      results.push({ variant, scenario, initialScripts, loadedScripts: resources, manualOrAutomaticOpen: "passed", failedSaveRetainsInput: scenario === "manual" ? "passed" : "not exercised", snoozeAndReopen: "passed", errors });
      await context.close();
    }
  }
  await writeFile(join(proof, "profile-browser.json"), `${JSON.stringify({ mode: "Production React, real form, fixture identity and intercepted saves; not authenticated server proof", dialogFiles, results }, null, 2)}\n`);
  console.table(results.map(({ initialScripts, loadedScripts, errors, ...result }) => ({ ...result, initialScripts: initialScripts.length, scriptsAfterOpen: loadedScripts.length, errors: errors.length })));
} finally {
  await browser?.close();
  await new Promise((done) => server ? server.close(done) : done());
  await rm(temporary, { recursive: true, force: true });
}
