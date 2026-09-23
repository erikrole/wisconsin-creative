import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/role/Code/wisconsin-creative";
const out = join(root, "tasks/archive/proofs/three-slices-visual-2026-09-17/web/authenticated");
mkdirSync(out, { recursive: true });

const hockeyEventId = "cmsoe6k300001la042i8l9jw2";
const xcMenEventId = "cms8ooryy0001kt04xgl3q8ow";
const xcWomenEventId = "cms8ooryy0000kt04gvdgwldb";
const badgeUserId = process.env.BADGE_USER_ID || "cmqr14yab0000l204htor0942";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: join(root, "test-results/playwright/auth/user.json"),
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-US",
  timezoneId: "America/Chicago",
});
const page = await context.newPage();

async function shot(name, options = {}) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: options.fullPage ?? false });
  console.log("shot", name, page.url());
}

async function goto(path) {
  const response = await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: "domcontentloaded" });
  return response;
}

async function dismissProfileWizard() {
  const remind = page.getByRole("button", { name: "Remind me tomorrow" });
  if (await remind.isVisible().catch(() => false)) {
    await remind.click();
    await page.getByRole("button", { name: "Remind me tomorrow" }).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }
}

await goto("/schedule");
await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor({ timeout: 20000 });
if (await page.getByRole("button", { name: "Remind me tomorrow" }).isVisible().catch(() => false)) {
  console.log("PROFILE_WIZARD_STILL_OPEN");
  await dismissProfileWizard();
}
await page.getByText(/Hockey|Football|Volleyball|Cross Country/i).first().waitFor({ timeout: 20000 });
await shot("schedule-admin-desktop");

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "domcontentloaded" });
await dismissProfileWizard();
await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor({ timeout: 20000 });
await page.getByText(/Hockey|Football|Volleyball|Cross Country/i).first().waitFor({ timeout: 20000 });
await shot("schedule-admin-phone");

await page.setViewportSize({ width: 1280, height: 800 });
await goto(`/events/${hockeyEventId}`);
await dismissProfileWizard();
await page.getByText(/Robert Morris|Hockey/i).first().waitFor({ timeout: 20000 });
const publishNow = page.getByRole("button", { name: /Publish now|Apply correction now/i }).first();
if (await publishNow.count()) {
  await publishNow.scrollIntoViewIfNeeded();
}
await shot("event-hockey-pending-desktop", { fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await shot("event-hockey-pending-phone", { fullPage: true });

await page.setViewportSize({ width: 1280, height: 800 });
await goto(`/events/${xcMenEventId}`);
await page.waitForTimeout(1500);
await shot("event-xc-men-ended-pending-desktop", { fullPage: true });

await goto(`/events/${xcWomenEventId}`);
await page.waitForTimeout(1500);
await shot("event-xc-women-combined-desktop", { fullPage: true });

const previewButton = page.getByRole("button", { name: /Preview as/i });
if (await previewButton.count()) {
  await previewButton.click();
  await page.getByRole("menuitem", { name: /Student/i }).click();
  await page.getByText("Previewing as Student", { exact: true }).waitFor({ timeout: 15000 });
  await goto("/schedule");
  await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor({ timeout: 20000 });
  await page.getByText(/Hockey|Football|Volleyball|Cross Country|Soccer/i).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("schedule-student-preview-desktop");
  await goto(`/events/${hockeyEventId}`);
  await page.getByText("Staff are updating this crew. Claims open after the changes are released.").waitFor({ timeout: 20000 });
  await shot("event-hockey-student-preview-desktop", { fullPage: true });
  await page.getByRole("button", { name: /Exit preview/i }).click();
  await page.waitForTimeout(1000);
} else {
  console.log("NO_PREVIEW_CONTROL");
}

if (badgeUserId) {
  await goto(`/users/${badgeUserId}?tab=badges`);
  await page.getByRole("heading", { name: "Gear Flow" }).waitFor({ timeout: 20000 });
  await shot("badges-shelf-desktop", { fullPage: true });
  const award = page.getByRole("button", { name: /^Award$/i }).first();
  if (await award.count()) {
    await award.click();
    await page.waitForTimeout(800);
    await shot("badges-award-catalog-desktop");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Gear Flow" }).waitFor({ timeout: 20000 });
  await shot("badges-shelf-phone", { fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
}

await goto("/users/cmotbr3cz0001kv8jfsrg0ank?tab=badges");
await page.getByRole("heading", { name: "Gear Flow" }).waitFor({ timeout: 20000 });
await shot("badges-admin-self-desktop", { fullPage: true });

await browser.close();
console.log("done", out);
