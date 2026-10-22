import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import sharp from "sharp";
import { getProfileCompletion } from "@/lib/profile-completion";

let browser: Browser; let server: Server; let origin: string;
const baseProfile = () => ({
  id: "student", name: "Alex Rivera", role: "STUDENT" as const, email: "alex.fixture@wisc.edu",
  athleticsEmail: null, phone: "(608) 555-0123", personalPhone: "(608) 555-0123", workPhone: null, workPhoneNotApplicable: false,
  wiscardCardNumber: "1234567890", wiscardIssueCode: "1", studentYearOverride: "FRESHMAN" as const,
  graduationTerm: null, gradYear: null, topSizeFit: "MENS" as const, topSize: null as string | null,
  shoeSizeSystem: "US_WOMENS" as const, shoeSize: "10", avatarUrl: null,
  onboardingRequired: true, onboardingCompletedAt: null as string | null, profilePromptSnoozedUntil: null,
});

test.beforeAll(async () => {
  const bundle = await build({ entryPoints: ["tests/fixtures/onboarding-browser.tsx"], bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); }
    else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); }
    else if (req.url?.startsWith("/fonts/")) { try { res.end(await readFile(path.join("public", req.url))); } catch { res.statusCode = 404; res.end(); } }
    else { res.setHeader("Content-Type", "text/html"); res.end('<html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
test.afterAll(async () => { await browser?.close(); server?.close(); });

async function open(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, locale: "en-US", timezoneId: "America/Chicago", reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-22T15:00:00Z"));
  const state = { profile: baseProfile(), version: 0, writes: [] as Array<{ step: string; group?: string; expectedVersion?: string; values?: Record<string, unknown> }>, holdRead: false, holdWrite: false, releaseRead: null as (() => void) | null, releaseWrite: null as (() => void) | null, conflict: false };
  const envelope = () => ({ data: { profile: { ...state.profile }, completion: getProfileCompletion(state.profile), versions: Object.fromEntries(["EMAIL", "PERSONAL_PHONE", "WORK_PHONE", "WISCARD", "STUDENT", "GRADUATION", "CLOTHING", "SHOES"].map((group) => [group, state.version.toString(16).padStart(64, "0")])) } });
  await page.route("**/api/me/profile-completion", async (route) => {
    if (route.request().method() === "GET") {
      const snapshot = envelope();
      if (state.holdRead) { state.holdRead = false; await new Promise<void>((resolve) => { state.releaseRead = resolve; }); }
      try { await route.fulfill({ json: snapshot }); } catch { /* A cancelled read is expected during a save. */ }
    } else {
      const body = route.request().postDataJSON(); state.writes.push(body);
      if (state.holdWrite) { state.holdWrite = false; await new Promise<void>((resolve) => { state.releaseWrite = resolve; }); }
      if (state.conflict) { await route.fulfill({ status: 409, json: { code: "ONBOARDING_CONFLICT", error: "Changed elsewhere" } }); return; }
      if (body.step === "SAVE") Object.assign(state.profile, body.values);
      if (body.step === "FINISH") { state.profile.onboardingRequired = false; state.profile.onboardingCompletedAt = "2026-10-22T15:00:00.123Z"; }
      state.version++; await route.fulfill({ json: envelope() });
    }
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Add your apparel sizes", exact: true })).toBeVisible();
  return { page, state };
}
async function topSize(page: Page, size: string) {
  await page.getByRole("combobox", { name: "Top size", exact: true }).click();
  await page.getByRole("option", { name: size, exact: true }).click();
}
async function capture(page: Page, name: string) {
  const output = process.env.ONBOARDING_CAPTURE_DIR; if (!output) return;
  await mkdir(output, { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  await writeFile(path.join(output, `${name}.capture.json`), JSON.stringify({ viewport: page.viewportSize(), browser: browser.version(), clock: "2026-10-22T15:00:00Z", locale: "en-US", timezone: "America/Chicago", fixture: "tests/browser/onboarding-continuity.spec.ts", evidence: "component fixture; no authenticated account or database" }, null, 2));
}

test("keeps an empty Other field visible, saves its value, and finishes without a photo", async () => {
  const { page, state } = await open();
  await topSize(page, "Other");
  await expect(page.getByLabel("Other top size", { exact: true })).toBeVisible();
  await page.waitForTimeout(650); // Longer than the explicit autosave debounce regression window.
  expect(state.writes).toHaveLength(0);
  await expect(page.getByLabel("Other top size", { exact: true })).toBeVisible();
  await page.getByLabel("Other top size", { exact: true }).fill("Custom tall M");
  await expect.poll(() => state.profile.topSize).toBe("Custom tall M");
  await expect(page.getByText("Saved to your account", { exact: true })).toBeVisible();
  await capture(page, "web-apparel-saved");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add a profile photo", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Top size", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); await capture(page, "web-optional-photo");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Setup complete", exact: true })).toBeVisible();
  expect(state.profile.onboardingCompletedAt).not.toBeNull();
  expect(state.profile.avatarUrl).toBeNull();
  await page.close();
});

test("a delayed read from before a save cannot replace its confirmed answer", async () => {
  const { page, state } = await open();
  state.holdRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => Boolean(state.releaseRead)).toBe(true);
  await topSize(page, "M");
  await expect.poll(() => state.profile.topSize).toBe("M");
  state.releaseRead!();
  await expect(page.getByRole("combobox", { name: "Top size", exact: true })).toContainText("M");
  await expect(page.getByText("Saved to your account", { exact: true })).toBeVisible();
  await page.close();
});

test("serializes edits typed during an in-flight save", async () => {
  const { page, state } = await open();
  await topSize(page, "Other"); state.holdWrite = true;
  await page.getByLabel("Other top size", { exact: true }).fill("Custom XS");
  await expect.poll(() => Boolean(state.releaseWrite)).toBe(true);
  await page.getByLabel("Other top size", { exact: true }).fill("Custom XL");
  state.releaseWrite!();
  await expect.poll(() => state.profile.topSize).toBe("Custom XL");
  await expect(page.getByLabel("Other top size", { exact: true })).toHaveValue("Custom XL");
  await expect(page.getByText("Saved to your account", { exact: true })).toBeVisible();
  expect(state.writes.at(-1)?.expectedVersion).toBe("1".padStart(64, "0"));
  await page.close();
});

test("keeps stale edits for an explicit conflict choice", async () => {
  const { page, state } = await open();
  state.conflict = true; state.profile.topSize = "S"; state.version = 1;
  await topSize(page, "L");
  await expect(page.getByRole("button", { name: "Use saved answers", exact: true })).toBeVisible();
  expect(state.writes[0]?.expectedVersion).toBe("0".repeat(64));
  await expect(page.getByRole("combobox", { name: "Top size", exact: true })).toContainText("L");
  await capture(page, "web-save-conflict");
  state.conflict = false;
  await page.getByRole("button", { name: "Save my answers", exact: true }).click();
  await expect.poll(() => state.profile.topSize).toBe("L");
  expect(state.writes.at(-1)?.expectedVersion).toBe("1".padStart(64, "0"));
  await page.close();
});

test("keeps checklist actions when browser storage is unavailable", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Storage denied", "SecurityError"); }; });
  const writes: unknown[] = [];
  await page.route("**/api/me/getting-started", async (route) => {
    if (route.request().method() === "PATCH") writes.push(route.request().postDataJSON());
    await route.fulfill({ json: { userId: "student", data: { done: writes.length ? ["guides"] : [], dismissed: false } } });
  });
  await page.goto(`${origin}/?view=checklist`);
  await expect(page.getByTestId("checklist")).toContainText('"done":[]');
  await page.getByRole("button", { name: "Read guide", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByTestId("checklist")).toContainText("guides");
  expect(writes[0]).toMatchObject({ done: ["guides"], expectedUserId: "student" });
  await page.close();
});

test("preserves a failed crop for retry and uploads a resized image", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  let attempts = 0;
  await page.route("**/api/users/student/avatar", async (route) => {
    attempts++;
    if (attempts === 1) { await route.fulfill({ status: 503, json: { error: "Upload interrupted. Your crop is still here." } }); return; }
    const form = await new Request("https://fixture.test", { method: "POST", headers: { "content-type": route.request().headers()["content-type"]! }, body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
    const file = form.get("file") as File;
    expect(file.type).toBe("image/webp");
    const output = Buffer.from(await file.arrayBuffer());
    expect(await sharp(output).metadata()).toMatchObject({ width: 512, height: 512 });
    // Compare the uploaded pixels to the selected circle's square bounds in
    // the actual preview, allowing only interpolation/WebP encoding loss.
    const actual = await sharp(output).removeAlpha().raw().toBuffer();
    const expected = await sharp(expectedPhoto).removeAlpha().raw().toBuffer();
    let error = 0;
    for (let i = 0; i < actual.length; i++) error += Math.abs(actual[i]! - expected[i]!);
    expect(error / actual.length).toBeLessThan(5);
    expect(route.request().headers()["x-avatar-url"]).toBe("https://example.test/original.webp");
    await route.fulfill({ json: { data: { avatarUrl: `https://fixture.test/${form.get("uploadId")}-saved.webp` } } });
  });
  await page.goto(`${origin}/?view=crop`);
  const sample = await sharp(Buffer.from('<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="#167d8d"/><circle cx="600" cy="550" r="300" fill="#f0b45b"/><path d="M100 1600v-260a500 500 0 0 1 1000 0v260" fill="#f0b45b"/></svg>')).png().toBuffer();
  await page.getByLabel("Choose photo", { exact: true }).setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: sample });
  await expect(page.getByRole("button", { name: "Save photo", exact: true })).toBeEnabled();
  const preview = page.getByRole("img", { name: /profile photo crop preview/ });
  await expect(page.getByRole("slider")).toHaveCount(0);
  const initial = await preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await preview.hover(); await page.mouse.wheel(0, -250);
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  const bounds = (await preview.boundingBox())!;
  const zoomed = await preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 25, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(zoomed);
  const adjusted = await preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  const expectedPhoto = await sharp(Buffer.from(adjusted.split(",")[1]!, "base64"))
    .extract({ left: 40, top: 40, width: 560, height: 560 }).resize(512, 512).png().toBuffer();
  await capture(page, "web-avatar-crop");
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  expect(await preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).toBe(adjusted);
  await capture(page, "web-avatar-retry");
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toBe(2);
  await page.close();
});

test("supports touch pinch and keyboard crop recovery without sliders", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  await page.goto(`${origin}/?view=crop`);
  const sample = await sharp(Buffer.from('<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="#167d8d"/><circle cx="600" cy="550" r="300" fill="#f0b45b"/></svg>')).png().toBuffer();
  await page.getByLabel("Choose photo", { exact: true }).setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: sample });
  await expect(page.getByRole("button", { name: "Save photo", exact: true })).toBeEnabled();
  const preview = page.getByRole("img", { name: /profile photo crop preview/ });
  await expect(page.getByRole("slider")).toHaveCount(0);
  const initial = await preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  const bounds = (await preview.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
  for (const spread of [40, 50, 65]) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await capture(page, "web-avatar-touch");
  await preview.press("Home");
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).toBe(initial);
  await preview.press("+"); await preview.press("ArrowRight");
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).toBe(initial);
  await page.close();
});
