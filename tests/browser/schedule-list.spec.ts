import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// The real Schedule list in Chromium. Only Next's Link is replaced; every
// position below is measured, not read from source.
let browser: Browser; let server: Server; let origin: string;
const STICKY_BOTTOM = 120;

test.beforeAll(async () => {
  const adapters: Record<string, string> = {
    "next/navigation": 'export const useRouter = () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }); export const usePathname = () => "/schedule"; export const useSearchParams = () => new URLSearchParams();',
    "next/link": 'import React from "react"; export default function Link({ prefetch, ...p }) { return <a {...p}/>; }',
    "next/image": 'import React from "react"; export default function Image({ fill, sizes, priority, ...p }) { return <img {...p}/>; }',
    // next/font only works inside the Next compiler (same stub as tests/_setup.ts).
    "next/font/google": 'export const Lato = () => ({ className: "", variable: "", style: {} });',
  };
  const bundle = await build({
    entryPoints: ["tests/fixtures/schedule-list-browser.tsx"], bundle: true, write: false,
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "framework-adapters", setup(b) {
      b.onResolve({ filter: /^next\/(navigation|link|image|font\/google)$/ }, (args) => ({ path: args.path, namespace: "adapter" }));
      b.onLoad({ filter: /.*/, namespace: "adapter" }, (args) => ({ contents: adapters[args.path], loader: "tsx", resolveDir: process.cwd() }));
    } }],
  });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); }
    else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); }
    else if (req.url?.startsWith("/fonts/")) { try { res.end(await readFile(path.join("public", req.url))); } catch { res.statusCode = 404; res.end(); } }
    else { res.setHeader("Content-Type", "text/html"); res.end('<html lang="en" data-theme="light"><head><title>Schedule</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
test.afterAll(async () => { await browser?.close(); server?.close(); });

async function open({ width = 1280, query = "", storedScroll }: { width?: number; query?: string; storedScroll?: number } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US", timezoneId: "America/Chicago", reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => { throw error; });
  await page.clock.setFixedTime(new Date("2026-10-22T15:00:00Z"));
  if (storedScroll !== undefined) {
    await page.addInitScript((y) => sessionStorage.setItem("schedule:timeline-scroll", String(y)), storedScroll);
  }
  await page.goto(`${origin}/schedule${query}`);
  await expect(todayGroup(page)).toBeVisible();
  await settle(page);
  return page;
}
function todayGroup(page: Page) {
  return page.locator("[data-schedule-day]").filter({ visible: true }).filter({ has: page.getByText("Today", { exact: true }) });
}
async function todayTop(page: Page) {
  return (await todayGroup(page).boundingBox())!.y;
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function fixtureState<T>(page: Page, key: "olderRequests" | "setupRequests" | "expandedPointer"): Promise<T> {
  return page.evaluate((k) => (window as unknown as { schedule: Record<string, unknown> }).schedule[k] as T, key);
}
async function control(page: Page, name: "refresh" | "prependOlder", arg?: number) {
  await page.evaluate(([n, a]) => (window as unknown as { schedule: Record<string, (x?: number) => void> }).schedule[n as string]!(a as number | undefined), [name, arg] as const);
  await settle(page);
}
/** Screenshots for PR review, written only when SCHEDULE_LIST_CAPTURE_DIR is set. */
async function capture(page: Page, name: string) {
  const output = process.env.SCHEDULE_LIST_CAPTURE_DIR; if (!output) return;
  await mkdir(output, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
}
/** A wheel is how a reader takes the page; programmatic scrolls do not count. */
async function readerScroll(page: Page, deltaY: number) {
  const start = await page.evaluate(() => window.scrollY);
  await page.mouse.move(640, 600);
  await page.mouse.wheel(0, deltaY);
  await page.waitForFunction((from) => Math.abs(window.scrollY - from) > 10, start);
  await settle(page);
}

test.describe("schedule list timeline", () => {
  test("opens with today pinned under the sticky frame, past above and upcoming below", async () => {
    const page = await open();
    try {
      expect(Math.abs((await todayTop(page)) - STICKY_BOTTOM)).toBeLessThanOrEqual(2);
      await expect(todayGroup(page)).toContainText("Past above · upcoming below");
      await expect(todayGroup(page)).toContainText("2 events");
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      // Day headers stick at the frame's bottom edge, not the viewport top.
      await readerScroll(page, 60);
      const header = todayGroup(page).locator("> div").first();
      await capture(page, "sticky-day-header");
      expect(Math.round((await header.boundingBox())!.y)).toBe(STICKY_BOTTOM);
    } finally { await page.close(); }
  });

  test("re-anchors on today when content above grows before the reader touches the page", async () => {
    const page = await open();
    try {
      await page.evaluate(() => (window as unknown as { schedule: { growAbove: (px: number) => void } }).schedule.growAbove(240));
      await expect.poll(() => todayTop(page)).toBeCloseTo(STICKY_BOTTOM, 0);
    } finally { await page.close(); }
  });

  test("leaves the reader where they are when data refreshes or content grows", async () => {
    const page = await open();
    try {
      await readerScroll(page, -900);
      const y = await page.evaluate(() => window.scrollY);
      await control(page, "refresh");
      await page.evaluate(() => (window as unknown as { schedule: { growAbove: (px: number) => void } }).schedule.growAbove(0));
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => window.scrollY)).toBe(y);
    } finally { await page.close(); }
  });

  test("does not load older history until the reader scrolls toward it", async () => {
    const page = await open();
    try {
      await page.waitForTimeout(300);
      const requests = () => fixtureState<number>(page, "olderRequests");
      expect(await requests()).toBe(0);
      await readerScroll(page, -20_000);
      await expect.poll(requests).toBeGreaterThan(0);
    } finally { await page.close(); }
  });

  test("keeps the reader's event in place when older rows prepend above it", async () => {
    const page = await open();
    try {
      await readerScroll(page, -600);
      const event = page.locator("[data-schedule-event-id]").filter({ visible: true }).nth(3);
      const id = await event.getAttribute("data-schedule-event-id");
      const before = (await event.boundingBox())!.y;
      await control(page, "prependOlder");
      const after = (await page.locator(`[data-schedule-event-id="${id}"]`).filter({ visible: true }).boundingBox())!.y;
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    } finally { await page.close(); }
  });

  test("offers a way back to today once it scrolls off, from either direction", async () => {
    const page = await open();
    try {
      const jump = page.getByRole("button", { name: /Jump to today/ });
      await expect(jump).toBeHidden();
      await readerScroll(page, -2000);
      await expect(jump).toBeVisible();
      await jump.click();
      await expect.poll(() => todayTop(page)).toBeCloseTo(STICKY_BOTTOM, 0);
      await expect(jump).toBeHidden();
      await readerScroll(page, 3000);
      await expect(jump).toBeVisible();
    } finally { await page.close(); }
  });

  test("returns to the reader's place after opening an event and going back", async () => {
    const page = await open();
    try {
      await readerScroll(page, -1500);
      const clickY = await page.evaluate(() => window.scrollY);
      // A link mid-viewport, so the click itself does not scroll the page.
      const href = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('[data-schedule-event-id] a[href^="/events/"]')]
        .find((a) => { const top = a.getBoundingClientRect().top; return a.offsetParent && top > 300 && top < 700; })!.getAttribute("href"));
      const link = page.locator(`a[href="${href}"]`).filter({ visible: true }).first();
      await link.click();
      await expect(page).toHaveURL(/\/events\//);
      await page.goBack();
      await expect(page).toHaveURL(/\/schedule$/);
      expect(clickY).toBeGreaterThan(500);
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(Math.round(clickY));
    } finally { await page.close(); }
  });

  test("opens on today after a refresh even though a position was stored", async () => {
    const page = await open();
    try {
      await readerScroll(page, -1500);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => sessionStorage.getItem("schedule:timeline-scroll"))).not.toBeNull();
      await page.reload();
      await expect(todayGroup(page)).toBeVisible();
      await expect.poll(() => todayTop(page)).toBeCloseTo(STICKY_BOTTOM, 0);
    } finally { await page.close(); }
  });

  test("restores the visible event after a view round trip", async () => {
    const page = await open();
    try {
      await readerScroll(page, -1200);
      const top = await page.evaluate((frame) => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-schedule-event-id]")].filter((row) => row.offsetParent);
        const row = rows.find((candidate) => candidate.getBoundingClientRect().top >= frame)!;
        return { id: row.dataset.scheduleEventId!, y: row.getBoundingClientRect().top };
      }, STICKY_BOTTOM);
      // Clicking the view control moves focus, which must not replace the saved anchor.
      await page.getByRole("button", { name: "Week", exact: true }).click();
      await page.waitForTimeout(150);
      const row = page.locator(`[data-schedule-event-id="${top.id}"]`).filter({ visible: true });
      await expect.poll(async () => Math.abs((await row.boundingBox())!.y - top.y)).toBeLessThanOrEqual(4);
    } finally { await page.close(); }
  });

  test("still anchors on today when rows arrive after loading has settled", async () => {
    const page = await open({ query: "?late=1" });
    try {
      await expect.poll(() => todayTop(page)).toBeCloseTo(STICKY_BOTTOM, 0);
    } finally { await page.close(); }
  });

  test("opens a fresh visit on today, not a position stored by an earlier visit", async () => {
    const page = await open({ storedScroll: 300 });
    try {
      expect(Math.abs((await todayTop(page)) - STICKY_BOTTOM)).toBeLessThanOrEqual(2);
    } finally { await page.close(); }
  });

  test("gives staff crew actions from the row menu, including setup for an event with no crew", async () => {
    const page = await open();
    try {
      const actions = (id: string) => page.locator(`[data-schedule-event-id="${id}"]`).filter({ visible: true }).getByRole("button", { name: /^Actions for/ });
      await actions("ev-1-0").click();
      await expect(page.getByRole("menuitem", { name: "Manage crew · 1 open" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Open Event detail" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Hide event" })).toBeVisible();
      await page.keyboard.press("Escape");

      await actions("ev-1-1").click();
      await page.getByRole("menuitem", { name: "Set up crew" }).hover();
      for (const choice of ["Use Home defaults", "Start empty"]) await expect(page.getByRole("menuitem", { name: choice })).toBeVisible();
      await page.getByRole("menuitem", { name: "Use Away defaults" }).click();
      expect(await fixtureState<string[]>(page, "setupRequests")).toEqual(["ev-1-1:AWAY"]);
    } finally { await page.close(); }
  });

  test("keeps several rows open and only clears the pointer for the row that owns it", async () => {
    const page = await open();
    try {
      const toggle = (id: string) => page.locator(`[data-schedule-event-id="${id}"]`).filter({ visible: true }).getByRole("button", { name: /shifts$/ });
      await toggle("ev-0-0").click();
      await toggle("ev-0-1").click();
      await expect(toggle("ev-0-0")).toHaveAttribute("aria-expanded", "true");
      await expect(toggle("ev-0-1")).toHaveAttribute("aria-expanded", "true");
      expect(await fixtureState<string | null>(page, "expandedPointer")).toBe("ev-0-1");
      await toggle("ev-0-0").click();
      expect(await fixtureState<string | null>(page, "expandedPointer")).toBe("ev-0-1");
      await toggle("ev-0-1").click();
      expect(await fixtureState<string | null>(page, "expandedPointer")).toBeNull();
    } finally { await page.close(); }
  });

  test("counts today as gone once it slides under the live frame, even if the published offset lags", async () => {
    const page = await open({ query: "?published=60" });
    try {
      const jump = page.getByRole("button", { name: /Jump to today/ });
      const box = (await todayGroup(page).boundingBox())!;
      // Leave today's bottom edge between the stale offset (60) and the real frame (120).
      await readerScroll(page, Math.round(box.y + box.height - 90));
      const bottom = await todayGroup(page).evaluate((el) => el.getBoundingClientRect().bottom);
      expect(bottom).toBeGreaterThan(60);
      expect(bottom).toBeLessThanOrEqual(STICKY_BOTTOM);
      await expect(jump).toBeVisible();
    } finally { await page.close(); }
  });

  test("groups phone cards by day with the same row actions and disclosure", async () => {
    const page = await open({ width: 390 });
    try {
      expect(Math.abs((await todayTop(page)) - STICKY_BOTTOM)).toBeLessThanOrEqual(2);
      const card = page.locator('[data-schedule-event-id="ev-0-0"]').filter({ visible: true });
      await expect(card.locator("xpath=..")).toHaveAttribute("data-today", "true");
      const disclosure = card.locator("button[aria-controls]");
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await disclosure.click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await card.getByRole("button", { name: /^Actions for/ }).click();
      await expect(page.getByRole("menuitem", { name: "Hide event" })).toBeVisible();
    } finally { await page.close(); }
  });

  test("lines every row's cells up with the column header", async () => {
    const page = await open();
    try {
      const columns = await page.evaluate(() => {
        const grids = [...document.querySelectorAll("[data-event-column='status']")].filter((cell) => (cell as HTMLElement).offsetParent);
        return [...new Set(grids.map((cell) => Math.round(cell.getBoundingClientRect().left)))];
      });
      expect(columns).toHaveLength(1);
    } finally { await page.close(); }
  });
});
