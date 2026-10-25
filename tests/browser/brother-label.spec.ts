import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LabelBitmap } from "@/lib/brother-label-render";
import type { LabelRow } from "@/lib/brother-label-csv";

// The real renderer draws with the real Gotham outlines and is checked by the
// real jsQR decoder, as on the Labels page. Nothing here talks to a printer.
let browser: Browser;
let server: Server;
let origin: string;
let fontRequests = 0;
let failFont = false;

type Rendered = Omit<LabelBitmap, "ink" | "preview"> & { inked: number; qrInked: number; preview: string; text: { width: number; height: number } };

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["tests/fixtures/brother-label-browser.ts"], bundle: true, write: false,
    define: { "process.env.NODE_ENV": '"test"' },
  });
  server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); }
    else if (req.url === "/GothamXNarrow-Bold.outlines.json") {
      fontRequests += 1;
      if (failFont) { res.statusCode = 503; res.end(); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(await readFile(path.join(process.cwd(), "public", req.url)));
    } else if (req.url === "/qrcode/vendor/jsQR.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await readFile(path.join(process.cwd(), "public", req.url)));
    } else { res.setHeader("Content-Type", "text/html"); res.end('<html lang="en"><head><title>Labels</title></head><body><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
test.afterAll(async () => { await browser?.close(); server?.close(); });
test.beforeEach(() => { fontRequests = 0; failFont = false; });

async function open(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => "renderBrotherLabel" in window);
  return page;
}

const row = (overrides: Partial<LabelRow>): LabelRow => ({
  kind: "body", dept: "VIDEO", model: "SONY FX3", number: "4", qrCodeValue: "BODY-FX3-4", copies: 1, ...overrides,
});

/** Renders in the page and returns the bitmap's shape, how much ink it has, and how much sits in the QR column. */
function render(page: Page, label: LabelRow) {
  return page.evaluate(async (input) => {
    const api = window as unknown as { renderBrotherLabel: (row: unknown) => Promise<{ width: number; height: number; ink: Uint8Array; preview: string }> };
    const bitmap = await api.renderBrotherLabel(input);
    let inked = 0, qrInked = 0;
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
      if (!bitmap.ink[y * bitmap.width + x]) continue;
      inked += 1;
      if (x >= bitmap.width - 70) qrInked += 1;
    }
    // The text sits left of the 63-dot QR and its 18-dot gap; measure its own ink.
    let left = bitmap.width, right = -1;
    for (let x = 0; x < bitmap.width; x++) for (let y = 0; y < bitmap.height; y++) if (bitmap.ink[y * bitmap.width + x]) { left = Math.min(left, x); right = Math.max(right, x); }
    const textRight = right - 81;
    let tl = bitmap.width, tr = -1, tt = bitmap.height, tb = -1;
    for (let y = 0; y < bitmap.height; y++) for (let x = left; x <= textRight; x++) if (bitmap.ink[y * bitmap.width + x]) {
      tl = Math.min(tl, x); tr = Math.max(tr, x); tt = Math.min(tt, y); tb = Math.max(tb, y);
    }
    const text = { width: tr - tl + 1, height: tb - tt + 1 };
    return { width: bitmap.width, height: bitmap.height, inked, qrInked, preview: bitmap.preview.slice(0, 22), text };
  }, label) as Promise<Rendered>;
}

function renderError(page: Page, label: LabelRow) {
  return page.evaluate(async (input) => {
    const api = window as unknown as { renderBrotherLabel: (row: unknown) => Promise<unknown> };
    try { await api.renderBrotherLabel(input); return null; } catch (error) { return (error as Error).message; }
  }, label);
}

function verify(page: Page, label: LabelRow, expected: string) {
  return page.evaluate(async ({ input, value }) => {
    const api = window as unknown as {
      renderBrotherLabel: (row: unknown) => Promise<unknown>;
      verifyBrotherQr: (bitmap: unknown, expected: string) => Promise<void>;
    };
    try { await api.verifyBrotherQr(await api.renderBrotherLabel(input), value); return null; } catch (error) { return (error as Error).message; }
  }, { input: label, value: expected });
}

test("prints a camera body as three lines of text beside a QR that scans back to the item", async () => {
  const page = await open();
  const bitmap = await render(page, row({}));

  expect(bitmap).toMatchObject({ width: 194, height: 76, preview: "data:image/png;base64," });
  expect(bitmap.inked).toBeGreaterThan(bitmap.qrInked);
  expect(bitmap.qrInked).toBeGreaterThan(500);
  expect(await verify(page, row({}), "BODY-FX3-4")).toBeNull();
});

test("refuses to print a QR that does not decode to the item's own value", async () => {
  const page = await open();
  expect(await verify(page, row({}), "BODY-FX3-5")).toBe(
    "The rendered QR could not be verified against this item's identity. Printing is paused.",
  );
});

test("turns battery numbers sideways and still prints a scannable unit QR", async () => {
  const page = await open();
  const battery = row({ kind: "battery", dept: "", model: "", number: "12", qrCodeValue: "NPFZ100-12" });

  const bitmap = await render(page, battery);
  const upright = await render(page, { ...battery, kind: "numberTag" });

  expect(bitmap).toMatchObject({ width: 194, height: 76 });
  // The same digits read across on a number tag and up the side on a battery.
  expect(upright.text.width).toBeGreaterThan(upright.text.height);
  expect(bitmap.text.height).toBeGreaterThan(bitmap.text.width);
  expect(await verify(page, battery, "NPFZ100-12")).toBeNull();
});

test("sizes a text-only label to its words, with no QR", async () => {
  const page = await open();
  const short = await render(page, row({ kind: "text", dept: "", model: "EDIT BAY", number: "", qrCodeValue: "" }));
  const long = await render(page, row({ kind: "text", dept: "", model: "CAMP RANDALL EDIT BAY", number: "", qrCodeValue: "" }));

  expect(short.height).toBe(76);
  expect(short.width).toBeGreaterThanOrEqual(120);
  expect(long.width).toBeGreaterThan(short.width);
  expect(long.width).toBeLessThanOrEqual(480 + 56);
});

test("explains what to change instead of printing a bad label", async () => {
  const page = await open();

  expect(await renderError(page, row({ kind: "text", model: "  ", number: "", qrCodeValue: "" }))).toBe("Enter text for this label.");
  expect(await renderError(page, row({ model: "SONY\nFX3" }))).toBe("Use up to 200 characters per printed line, without line breaks.");
  expect(await renderError(page, row({ qrCodeValue: "a-qr-value-far-too-long-for-tape" }))).toBe(
    "This QR needs a larger label layout. Its identity has not been changed.",
  );
  expect(await renderError(page, row({ kind: "text", model: "EDIT ☃", number: "", qrCodeValue: "" }))).toBe(
    "Gotham cannot print “☃”. Edit the label text.",
  );
  expect(await renderError(page, row({ kind: "text", model: "W".repeat(120), number: "", qrCodeValue: "" }))).toBe(
    "Text is too long to fit legibly. Shorten the printed text.",
  );
});

test("loads the font once, and tries again after a failed load", async () => {
  const page = await open();
  failFont = true;
  expect(await renderError(page, row({ number: "1", qrCodeValue: "BODY-FX3-1" }))).toBe("Gotham could not load. Reload before printing.");

  failFont = false;
  await render(page, row({ number: "2", qrCodeValue: "BODY-FX3-2" }));
  await render(page, row({ number: "3", qrCodeValue: "BODY-FX3-3" }));
  expect(fontRequests).toBe(2);
});

test("reuses one render for the same label", async () => {
  const page = await open();
  const same = await page.evaluate((input) => {
    const api = window as unknown as { renderBrotherLabel: (row: unknown) => Promise<unknown> };
    return api.renderBrotherLabel(input) === api.renderBrotherLabel({ ...input, copies: 5 });
  }, row({}));
  expect(same).toBe(true);
});
