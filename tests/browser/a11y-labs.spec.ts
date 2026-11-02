import { test, expect } from "@playwright/test";
import { seriousAxeViolations } from "./axe";

// axe-core (WCAG 2.1 A/AA) over the DB-free dev labs served by `next dev`, so a
// regression in the shared shell, sidebar, tables, dialogs or theme tokens fails
// CI. Labs render the real pages with sample data and no database.
const labs = [
  "/dev-home", "/dev-home?role=student", "/dev-home?theme=dark", "/dev-items", "/dev-bookings",
  "/dev-schedule", "/dev-settings", "/dev-notifications", "/dev-search", "/dev-gear",
  "/dev-trade-board", "/dev-team-availability", "/dev-person-schedule", "/dev-kits", "/dev-reports", "/login",
];

for (const lab of labs) {
  for (const width of [1280, 390]) {
    test(`${lab} has no serious axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(lab, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      expect(await seriousAxeViolations(page)).toEqual([]);
    });
  }
}
