import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";
import { seed, stateFile, type Who } from "./helpers";

// One real sign-in per person. Every flow then reuses the saved session so the
// suite never trips the per-account login limit (10 attempts in 15 minutes).
for (const who of Object.keys(seed.users) as Who[]) {
  setup(`sign in as ${who} through the login form`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(seed.users[who].email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill(seed.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // Home greets the person by first name ("Good evening, Erin").
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Good \\w+, ${seed.users[who].name.split(" ")[0]}`) })).toBeVisible();
    mkdirSync("test-results/e2e-flows/auth", { recursive: true });
    await page.context().storageState({ path: stateFile(who) });
  });
}
