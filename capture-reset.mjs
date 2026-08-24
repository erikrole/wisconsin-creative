import { chromium } from "@playwright/test";

const [out, mode] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

// The local dev server has no database, so the account lookup is answered with
// a canned response — the same fixture approach the iOS captures use. The page,
// its layout, and its request are real.
if (mode === "stub") {
  await page.route("**/api/auth/reset-password/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "jordan.lee@wisc.edu" }),
    }),
  );
}

await page.goto("http://localhost:3000/reset-password?token=capture-fixture-token", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#password");
await page.waitForTimeout(1500);
await page.locator(".login-card").first().screenshot({ path: out });
console.log("captured", out);
await browser.close();
