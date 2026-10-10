import { test, expect, expect as browserExpect, chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import type { GearPicksMeResponse } from "@/lib/gear-picks/types";

// Real picker and query hook; only Next's framework adapters are replaced.
// Network fixtures prove browser behavior, not authenticated database persistence.
const baselineRevision = "e5b141cd4a5e1d939252771cc775d6cee83f51ee";
const baseline = process.env.GEAR_PICKER_BASELINE === "1";
const baselineDirectory = process.env.GEAR_PICKER_BASELINE_DIR;
let browser: Browser;
let server: Server;
let origin: string;
const fixture = (): GearPicksMeResponse => ({
  cycle: { id: "2027-28", title: "2027–28 staff picks", deadline: null, launchedAt: "2026-10-08T12:00:00Z", isOpen: true },
  participant: { id: "fixture-staff", fit: "MEN", allowanceCents: 19200 },
  submission: {
    version: 1, totalCents: 1500, submittedAt: null, updatedAt: "2026-10-08T12:00:00Z",
    lines: [{ sku: "6021649-005", style: "6021649", colorCode: "005", size: "M", quantity: 1,
      unitPriceCents: 1500, lineTotalCents: 1500, itemName: "Athletics SS Tee", colorLabel: "Black", category: "Tops" }],
  },
  profile: { topSize: "M", topSizeFit: "MENS", shoeSize: "10", shoeSizeSystem: "US_MENS" },
  isAdmin: false,
});

test.beforeAll(async () => {
  const adapters: Record<string, string> = {
    "next/navigation": 'export const useRouter = () => ({ push: () => {} });',
    "next/link": 'import React from "react"; export default function Link(p) { return <a {...p}/>; }',
    "next/image": 'import React from "react"; export default function Image({fill,sizes,priority,...p}) { return <img {...p} style={fill ? {position:"absolute",height:"100%",width:"100%",inset:0}:undefined}/>; }',
  };
  const bundle = await build({
    entryPoints: ["tests/fixtures/gear-picker-browser.tsx"], bundle: true, write: false,
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "framework-adapters", setup(b) {
      b.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({ path: args.path, namespace: "adapter" }));
      b.onLoad({ filter: /.*/, namespace: "adapter" }, (args) => ({ contents: adapters[args.path], loader: "tsx", resolveDir: process.cwd() }));
      if (baselineDirectory) b.onLoad({ filter: /\/(gear\/(Gear\w+\.tsx|gear-pick-state\.ts)|gear-picks\/catalog\.(ts|json)|gear-picks\/catalog-2027-28\.json)$/ }, async (args) => ({
        contents: await readFile(path.join(baselineDirectory, `${path.basename(args.path)}.txt`), "utf8"),
        loader: path.extname(args.path) === ".json" ? "json" : "tsx", resolveDir: path.dirname(args.path),
      }));
      if (baseline) b.onLoad({ filter: /\/(gear\/(Gear\w+\.tsx|gear-pick-state\.ts)|gear-picks\/catalog\.ts|gear-picks\/catalog-2027-28\.json)$/ }, (args) => ({
        contents: execFileSync("git", ["show", `${baselineRevision}:${path.relative(process.cwd(), args.path)}`], { encoding: "utf8" }),
        loader: path.extname(args.path) === ".json" ? "json" : "tsx", resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); }
    else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); }
    else if (req.url?.startsWith("/gear/") || req.url?.startsWith("/fonts/")) {
      if (req.url.endsWith(".svg")) res.setHeader("Content-Type", "image/svg+xml");
      try { res.end(await readFile(path.join(process.cwd(), "public", req.url))); } catch { res.statusCode = 404; res.end(); }
    } else { res.setHeader("Content-Type", "text/html"); res.end('<html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" style="padding:32px"></main><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
test.afterAll(async () => { await browser?.close(); server?.close(); });

async function open(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, locale: "en-US", timezoneId: "America/Chicago", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("gear-picks-intro-seen:2027-28:fixture-staff", "1"));
  await page.clock.setFixedTime(new Date("2026-10-08T17:00:00Z"));
  const state = { data: fixture(), failRead: false, writes: [] as { version: number; lines: { size: string; quantity: number }[] }[] };
  await page.route("**/api/gear-picks/me", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: state.failRead ? 503 : 200, json: state.failRead ? { error: "Offline" } : { data: state.data } });
    } else {
      state.writes.push(route.request().postDataJSON());
      await route.fulfill({ status: 409, json: { code: "GEAR_PICKS_STALE", error: "Your picks changed elsewhere." } });
    }
  });
  await page.goto(`${origin}/gear`);
  await browserExpect(page.getByRole("heading", { name: "UA staff gear", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("6021649");
  const size = page.getByRole("combobox", { name: /Size for Athletics SS Tee/ });
  await browserExpect(size).toHaveValue("M");
  return { page, state, size };
}
async function refresh(page: Page) {
  await page.evaluate(() => (window as unknown as { refreshGear: () => Promise<void> }).refreshGear());
}
async function capture(page: Page, name: string) {
  if (!process.env.GEAR_PICKER_CAPTURE_DIR) return;
  await mkdir(process.env.GEAR_PICKER_CAPTURE_DIR, { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#root > div")?.style.opacity === "1");
  const directory = process.env.GEAR_PICKER_CAPTURE_DIR;
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: "disabled" });
  const patch = baselineDirectory ? await readFile(path.join(baselineDirectory, "source.patch"), "utf8") : baseline ? null : execFileSync("git", ["diff", "--", "src/app/(app)/gear", "src/lib/gear-picks"], { encoding: "utf8" });
  if (patch) await writeFile(path.join(directory, "source.patch"), patch);
  const viewport = page.viewportSize()!;
  await writeFile(path.join(directory, `${name}.metadata.json`), JSON.stringify({
    sourceRevision: baseline || baselineDirectory ? baselineRevision : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourcePatchSha256: patch ? createHash("sha256").update(patch).digest("hex") : null,
    settings: {
      device: `Chromium ${browser.version()} fixture harness`, viewport: [viewport.width, viewport.height],
      fixture: createHash("sha256").update(await readFile("tests/browser/gear-picks.spec.ts")).update(await readFile("tests/fixtures/gear-picker-browser.tsx")).digest("hex"),
      role: "staff", route: "/gear", appearance: "light", textSize: "default", locale: "en-US",
      timezone: "America/Chicago", clock: "2026-10-08T17:00:00Z", scroll: [0, 0],
    },
  }, null, 2));
}

test.describe("gear picker save recovery", () => {
  test("never upgrades the version of unsaved edits after a background refresh", async () => {
    const { page, state, size } = await open();
    try {
      await size.selectOption("L");
      state.data.submission!.version = 2;
      state.data.submission!.lines[0]!.size = "S";
      await refresh(page);
      await browserExpect(size).toHaveValue("L");
      await browserExpect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
      await browserExpect(page.getByRole("alert")).toContainText("another tab");
      expect(state.writes).toHaveLength(0);
    } finally { await page.close(); }
  });

  test("keeps unsaved edits when a background read fails", async () => {
    const { page, state, size } = await open();
    try {
      await size.selectOption("L"); state.failRead = true; await refresh(page);
      await browserExpect(size).toHaveValue("L");
      await browserExpect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    } finally { await page.close(); }
  });

  test("preserves edits after a failed reload and adopts only a successful fresh list", async () => {
    const { page, state, size } = await open();
    try {
      await size.selectOption("L");
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      const reload = page.getByRole("button", { name: baseline ? "Reload" : "Discard edits & reload saved picks", exact: true });
      await browserExpect(reload).toBeVisible();
      await capture(page, "conflict-desktop");
      state.failRead = true; await reload.click();
      await browserExpect(size).toHaveValue("L");
      await browserExpect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      await browserExpect(page.getByRole("alert")).toContainText("Couldn't load");
      state.failRead = false; state.data.submission!.version = 2; state.data.submission!.lines[0]!.size = "S";
      await reload.click();
      await browserExpect(size).toHaveValue("S");
      await browserExpect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
    } finally { await page.close(); }
  });

  test("locks editing during a save and shows the acknowledged list afterwards", async () => {
    const { page, state, size } = await open();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/gear-picks/me", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON(); state.writes.push(body);
      await pending;
      const saved = structuredClone(state.data.submission!);
      saved.version = 2; saved.lines[0]!.size = body.lines[0].size;
      await route.fulfill({ json: { data: saved } });
    });
    try {
      await size.selectOption("L");
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await browserExpect(size).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Review & submit", exact: true })).toBeDisabled();
      release();
      await browserExpect(size).toBeEnabled();
      await browserExpect(size).toHaveValue("L");
      await browserExpect(page.getByText("Draft saved", { exact: true })).toBeVisible();
      expect(state.writes).toHaveLength(1); expect(state.writes[0]!.version).toBe(1);
    } finally { release(); await page.close(); }
  });

  test("retains unsaved choices when the deadline closes during save", async () => {
    const { page, size } = await open();
    await page.route("**/api/gear-picks/me", (route) => route.request().method() === "PUT"
      ? route.fulfill({ status: 409, json: { code: "GEAR_PICKS_CLOSED", error: "Picks are closed." } }) : route.fallback());
    try {
      await size.selectOption("L"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await browserExpect(size).toHaveValue("L"); await browserExpect(size).toBeDisabled();
      await browserExpect(page.getByText(/Your unsaved changes are still shown below/)).toBeVisible();
    } finally { await page.close(); }
  });

  test("keeps review open on an unconfirmed save and allows a successful retry", async () => {
    const { page, state } = await open();
    let attempts = 0;
    await page.route("**/api/gear-picks/me", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 502, contentType: "text/html", body: "Gateway unavailable" });
      const saved = structuredClone(state.data.submission!);
      saved.version = 2; saved.submittedAt = "2026-10-08T12:05:00Z";
      await route.fulfill({ json: { data: saved } });
    });
    try {
      await page.getByRole("button", { name: "Review & submit", exact: true }).click();
      const review = page.getByRole("dialog");
      await review.getByRole("button", { name: "Submit picks", exact: true }).click();
      await browserExpect(review.getByRole("alert")).toContainText("couldn't confirm");
      await review.getByRole("button", { name: "Submit picks", exact: true }).click();
      await browserExpect(review).not.toBeVisible();
      await browserExpect(page.getByText(/^Submitted Oct/)).toBeVisible();
      expect(attempts).toBe(2);
    } finally { await page.close(); }
  });

  test("offers a direct filter reset on a narrow screen", async () => {
    const { page } = await open(390);
    try {
      await page.getByRole("searchbox").fill("no-such-gear");
      await browserExpect(page.getByText("No items match", { exact: true })).toBeVisible();
      await capture(page, "empty-mobile");
      await page.getByRole("button", { name: "Show all gear", exact: true }).focus();
      await page.keyboard.press("Enter");
      await browserExpect(page.getByRole("searchbox")).toHaveValue("");
      await browserExpect(page.getByRole("switch", { name: /Within my allowance/ })).not.toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await page.close(); }
  });
});


test("catalog and review fit desktop and narrow screens", async () => {
  for (const width of [1280, 390]) {
    const { page } = await open(width);
    try {
      await page.getByRole("searchbox").fill("");
      await capture(page, `catalog-${width}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("searchbox").fill("6021649");
      await capture(page, `selected-${width}`);
      await page.getByRole("button", { name: width < 640 ? "Review" : "Review & submit", exact: true }).click();
      await browserExpect(page.getByRole("dialog")).toBeVisible();
      await capture(page, `review-${width}`);
      expect(await page.getByRole("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      if (!baseline && !baselineDirectory) {
        const kit = page.getByRole("button", { name: /Standard issue/ });
        await kit.focus(); await page.keyboard.press("Enter");
        await browserExpect(kit).toHaveAttribute("aria-expanded", "true");
        await kit.click();
        if (width < 768) {
          await page.getByRole("button", { name: "Filters", exact: true }).click();
          await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("Footwear");
          await browserExpect(page.getByText("No items match", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Show all gear", exact: true }).click();
          await browserExpect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveValue("all");
        }
      }
    } finally { await page.close(); }
  }
});


test("review edits update the order and stay locked while submitting", async () => {
  const { page, state } = await open();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/gear-picks/me", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON(); state.writes.push(body);
    await pending;
    const saved = structuredClone(state.data.submission!);
    saved.version = 2; saved.totalCents = 3000; saved.lines[0]!.size = "L";
    saved.lines[0]!.quantity = 2; saved.lines[0]!.lineTotalCents = 3000;
    saved.submittedAt = "2026-10-08T17:00:00Z";
    await route.fulfill({ json: { data: saved } });
  });
  try {
    await page.getByRole("button", { name: "Review & submit", exact: true }).click();
    const review = page.getByRole("dialog");
    const size = review.getByRole("combobox", { name: /Size for Athletics SS Tee/ });
    const color = review.getByRole("combobox", { name: "Color for Athletics SS Tee" });
    await color.selectOption("6021649-834");
    const quantity = review.getByRole("combobox", { name: /Quantity for Athletics SS Tee/ });
    await size.selectOption("");
    await browserExpect(review.getByRole("button", { name: "Submit picks", exact: true })).toBeDisabled();
    await size.selectOption("L"); await quantity.selectOption("2");
    await browserExpect(review.getByText("$162.00", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Submit picks", exact: true }).click();
    await browserExpect(size).toBeDisabled(); await browserExpect(quantity).toBeDisabled(); await browserExpect(color).toBeDisabled();
    await browserExpect(review.getByRole("button", { name: /Remove Athletics/ })).toHaveCount(0);
    release(); await browserExpect(review).not.toBeVisible();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.lines).toEqual([{ sku: "6021649-834", size: "L", quantity: 2 }]);
    await browserExpect(page.getByText("$162.00 left", { exact: true })).toBeVisible();
  } finally { release(); await page.close(); }
});


test("allowance filtering is optional and changing a review color detects duplicates", async () => {
  const {page, state} = await open();
  try {
    const filter = page.getByRole("switch", {name: "Within my allowance"});
    await browserExpect(filter).not.toBeChecked();
    state.data.participant!.allowanceCents = 1600; await refresh(page);
    await page.getByRole("searchbox").fill("6024284");
    await browserExpect(page.getByRole("article", {name: "UA Icon Lo"})).toBeVisible();
    await filter.click();
    await browserExpect(page.getByText("No items match", {exact: true})).toBeVisible();
    await filter.click(); await page.getByRole("searchbox").fill("6021649");
    await page.getByRole("button", {name: "Red (834)", exact: true}).click();
    await page.getByRole("button", {name: "Add to picks", exact: true}).click();
    await page.getByRole("button", {name: /Your picks/}).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", {name: "Color for Athletics SS Tee"}).last().selectOption("6021649-005");
    await browserExpect(dialog).toContainText("listed twice");
    expect(state.writes).toHaveLength(0);
  } finally {await page.close();}
});


test("item sizing controls require confirmation and use the catalog options", async () => {
  const {page} = await open(390);
  try {
    await page.getByRole("searchbox").fill("6026519");
    await page.getByRole("button", {name: "Add to picks", exact: true}).click();
    await page.getByRole("button", {name: /Your picks/}).click();
    await capture(page, "fitted-hat-390");
    await page.getByRole("dialog").getByRole("button", {name: "Close", exact: true}).click();
    if (baselineDirectory) return;
    const hat = page.getByRole("combobox", {name: /Size for Blitzing/});
    await browserExpect(hat).toHaveValue("");
    await browserExpect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await hat.selectOption("M/L");
    await browserExpect(page.getByRole("button", {name: "Save", exact: true})).toBeEnabled();
    await page.getByRole("searchbox").fill("6021627");
    await page.getByRole("button", {name: "Add to picks", exact: true}).click();
    const pants = page.getByRole("combobox", {name: /Size for Unstoppable Fleece Pant/});
    await browserExpect(pants).toHaveValue(""); await pants.selectOption("L");
    await page.getByRole("searchbox").fill("6013320");
    await page.getByRole("button", {name: "Add to picks", exact: true}).click();
    const shoe = page.getByRole("combobox", {name: /Size for UA Ignite/});
    await browserExpect(shoe).toHaveValue("10");
    await browserExpect(page.getByRole("paragraph").filter({hasText: "US men's shoe size"})).toBeVisible();
    expect(await shoe.locator("option").allTextContents()).not.toContain("10.5");
    await shoe.selectOption("");
    await browserExpect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
  } finally {await page.close();}
});


test("intro explains the current sizing and selection workflow", async () => {
  const {page} = await open(390);
  try {
    await page.getByRole("button", {name: "How it works", exact: true}).click();
    const intro = page.getByRole("dialog");
    await browserExpect(intro).toContainText("The department covers these separately");
    await browserExpect(intro).toContainText("Turn on “Within my allowance”");
    await browserExpect(intro).toContainText("Profile sizes fill in only when the sizing matches");
    await browserExpect(intro.getByRole("img", {name: "Under Armour"})).toBeVisible();
    await browserExpect.poll(() => intro.getByRole("img", {name: "Under Armour"}).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await capture(page, "intro-390");
    await intro.getByRole("button", {name: "Start picking"}).click();
    await browserExpect(intro).not.toBeVisible();
  } finally {await page.close();}
});
