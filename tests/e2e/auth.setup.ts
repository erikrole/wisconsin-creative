import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";

import { loadLocalPlaywrightEnv } from "./load-local-playwright-env";

loadLocalPlaywrightEnv();

export const AUTH_FILE = "test-results/playwright/auth/user.json";

const email = process.env.PLAYWRIGHT_EMAIL?.trim();
const password = process.env.PLAYWRIGHT_PASSWORD;
const role = process.env.PLAYWRIGHT_ROLE?.trim().toUpperCase();
const hasCredentials = Boolean(
  email && password && (role === "STUDENT" || role === "STAFF" || role === "ADMIN"),
);

setup.skip(
  !hasCredentials,
  "Set PLAYWRIGHT_EMAIL, PLAYWRIGHT_PASSWORD, and PLAYWRIGHT_ROLE, or run npm run auth:local, to run authenticated smoke locally.",
);

setup("authenticate through the normal sign-in flow", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/change-password");
  expect(page.url(), "The smoke identity must not require a password change").not.toContain(
    "/change-password",
  );
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
