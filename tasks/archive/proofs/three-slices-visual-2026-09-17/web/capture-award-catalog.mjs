import { chromium } from "playwright";
import { join } from "node:path";

const root = "/Users/role/Code/wisconsin-creative";
const out = join(root, "tasks/archive/proofs/three-slices-visual-2026-09-17/web/authenticated");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: join(root, "test-results/playwright/auth/user.json"),
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
await page.goto("http://127.0.0.1:3000/users/cmqr14yab0000l204htor0942?tab=badges", { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Gear Flow" }).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Admin actions" }).click();
await page.getByRole("menuitem", { name: "Award badge" }).click();
await page.getByRole("dialog").waitFor({ timeout: 10000 });
const existing = page.getByRole("tab", { name: "Existing" }).or(page.getByRole("button", { name: "Existing" }));
if (await existing.count()) await existing.first().click();
await page.getByText("Loading badges...").waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "badges-award-catalog-desktop.png") });
console.log("shot badges-award-catalog-desktop");
await page.keyboard.press("Escape");
await browser.close();
