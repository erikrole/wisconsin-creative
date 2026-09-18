import { defineConfig, devices } from "@playwright/test";
import { loadLocalPlaywrightEnv } from "./tests/e2e/load-local-playwright-env";
import { resolveSmokeSafety } from "./tests/e2e/smoke-safety";

loadLocalPlaywrightEnv();

const authFile = "test-results/playwright/auth/user.json";
const { baseURL, hasCredentials, strictMode } = resolveSmokeSafety();

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/playwright/results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  fullyParallel: false,
  forbidOnly: strictMode,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "desktop-chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["auth-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: hasCredentials ? authFile : undefined,
      },
    },
    {
      name: "narrow-mobile-chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["auth-setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        storageState: hasCredentials ? authFile : undefined,
      },
    },
  ],
});
