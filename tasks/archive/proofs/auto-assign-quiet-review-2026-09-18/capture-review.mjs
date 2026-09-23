import { chromium } from "playwright";
import { join } from "node:path";

const root = "/Users/role/Code/wisconsin-creative";
const out = join(root, "tasks/archive/proofs/auto-assign-quiet-review-2026-09-18");

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  storageState: join(root, "test-results/playwright/auth/user.json"),
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale: "en-US",
  timezoneId: "America/Chicago",
});
const page = await context.newPage();

await page.goto("http://127.0.0.1:3000/schedule", { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Auto assign" }).click({ force: true });
await page.getByRole("button", { name: "Build preview" }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Build preview" }).click();
await page.getByRole("dialog").getByText("Nothing ready to stage", { exact: true }).waitFor({ timeout: 45000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "after-outcome-review.png") });
console.log("captured", join(out, "after-outcome-review.png"));
await browser.close();
