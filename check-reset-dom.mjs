import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route("**/api/auth/reset-password/account", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ email: "jordan.lee@wisc.edu" }) }));
await page.goto("http://localhost:3000/reset-password?token=capture-fixture-token", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#password");
await page.waitForTimeout(1200);
console.log(JSON.stringify(await page.evaluate(() => {
  const u = document.querySelector('input[autocomplete="username"]');
  return {
    usernameField: u ? { value: u.value, readOnly: u.readOnly, tabIndex: u.tabIndex, name: u.name, offsetParent: u.offsetParent !== null } : null,
    passwordRules: [...document.querySelectorAll('input[autocomplete="new-password"]')].map((i) => i.getAttribute("passwordrules")),
    visibleAccountLine: document.body.innerText.includes("jordan.lee@wisc.edu"),
  };
}), null, 2));
await browser.close();
