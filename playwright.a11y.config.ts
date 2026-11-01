import { defineConfig } from "@playwright/test";

/** axe-core over the DB-free dev labs; `next dev` is started here with no database. */
export default defineConfig({
  testDir: "./tests/browser", testMatch: "a11y-labs.spec.ts",
  outputDir: "test-results/a11y-labs", workers: 1, reporter: "list",
  timeout: 120_000, expect: { timeout: 10_000 },
  use: { launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : undefined, baseURL: "http://127.0.0.1:3123", reducedMotion: "reduce", timezoneId: "America/Chicago" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3123",
    url: "http://127.0.0.1:3123/login",
    reuseExistingServer: true,
    timeout: 240_000,
    env: { SESSION_SECRET: "0".repeat(64), SESSION_COOKIE_NAME: "gear-tracker-session" },
  },
});
