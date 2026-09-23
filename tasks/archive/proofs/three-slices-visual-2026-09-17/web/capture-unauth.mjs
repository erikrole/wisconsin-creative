import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(dir, { recursive: true });

const routes = [
  ["/schedule", "schedule-redirect"],
  ["/notifications", "notifications-redirect"],
  ["/users/me?tab=badges", "badges-redirect"],
  ["/.well-known/apple-app-site-association", "aasa-local"],
];

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
const results = [];
for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/Chicago",
  });
  const page = await context.newPage();
  for (const [path, slug] of routes) {
    const response = await page.goto(`http://127.0.0.1:3000${path}`, {
      waitUntil: "networkidle",
    });
    const file = join(dir, `${slug}-${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results.push({
      path,
      viewport: viewport.name,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      file,
    });
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
